const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';

function verifyJWT(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('missing_token');
  }
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const token = bearer || req.query.token;
  try {
    req.user = verifyJWT(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function socketAuthMiddleware(socket, next) {
  const raw = socket.handshake.auth && socket.handshake.auth.token;
  try {
    const decoded = verifyJWT(raw);
    socket.user = {
      id: decoded.userId,
      name: decoded.name,
      avatar: decoded.avatar,
    };
    return next();
  } catch {
    return next(new Error('unauthorized'));
  }
}

module.exports = {
  verifyJWT,
  authMiddleware,
  socketAuthMiddleware,
  JWT_SECRET,
};
