require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const { Server } = require('socket.io');

const { pool } = require('./db/pool');
const { configurePassport } = require('./auth/passport');
const { socketAuthMiddleware } = require('./auth/middleware');
const authRouter = require('./routes/auth');
const {
  connectProducer,
  publishLocationEvent,
  disconnectProducer,
} = require('./kafka/producer');
const { createSocketBroadcasterConsumer } = require('./kafka/socketConsumer');
const { createDbWriterConsumer } = require('./kafka/dbConsumer');

const PORT = Number(process.env.PORT) || 3000;

function resolveFrontendRoot() {
  const dockerish = path.join(__dirname, '..', 'frontend');
  const monorepo = path.join(__dirname, '..', '..', 'frontend');
  if (fs.existsSync(path.join(dockerish, 'index.html'))) {
    return dockerish;
  }
  return monorepo;
}

function isValidLocation({ lat, lng, timestamp }) {
  return (
    typeof lat === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    lng >= -180 &&
    lng <= 180 &&
    typeof timestamp === 'number' &&
    Math.abs(Date.now() - timestamp) < 30000
  );
}

async function runMigrations() {
  const sqlPath = path.join(__dirname, 'db', 'migrations.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function bootstrap() {
  await runMigrations();
  console.log('[db] migrations applied');

  configurePassport();

  const app = express();
  const frontendRoot = resolveFrontendRoot();

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'change_me_too',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.use('/auth', authRouter);

  app.use(express.static(frontendRoot));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/socket.io')) {
      return next();
    }
    if (req.accepts('html')) {
      return res.sendFile(path.join(frontendRoot, 'index.html'));
    }
    return next();
  });

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true },
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    socket.on('location:update', async (payload) => {
      try {
        if (!isValidLocation(payload)) {
          return;
        }
        const userId = socket.user.id;
        await publishLocationEvent({
          userId,
          name: socket.user.name,
          avatar: socket.user.avatar || '',
          lat: payload.lat,
          lng: payload.lng,
          timestamp: payload.timestamp,
          socketId: socket.id,
        });
      } catch (err) {
        console.error('[socket] location:update error:', err.message || err);
      }
    });

    socket.on('disconnect', () => {
      io.emit('user:offline', { userId: socket.user.id });
    });
  });

  server.listen(PORT, () => {
    console.log(`[http] listening on :${PORT}`);
  });

  connectProducer().catch((err) => {
    console.error('[kafka] producer connect failed:', err.message || err);
  });

  const socketBroadcaster = createSocketBroadcasterConsumer(io);
  socketBroadcaster.run().catch((err) => {
    console.error('[kafka] socket consumer failed:', err.message || err);
  });

  const dbWriter = createDbWriterConsumer();
  dbWriter.run().catch((err) => {
    console.error('[kafka] db consumer failed:', err.message || err);
  });

  async function shutdown() {
    console.log('[shutdown] cleaning up...');
    try {
      await socketBroadcaster.stop();
    } catch (e) {
      console.error(e);
    }
    try {
      await dbWriter.stop();
    } catch (e) {
      console.error(e);
    }
    try {
      await disconnectProducer();
    } catch (e) {
      console.error(e);
    }
    try {
      await pool.end();
    } catch (e) {
      console.error(e);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
