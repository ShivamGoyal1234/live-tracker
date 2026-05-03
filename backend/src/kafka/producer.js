const { Kafka, logLevel } = require('kafkajs');

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const kafka = new Kafka({
  clientId: 'location-server',
  brokers,
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

const admin = kafka.admin();

let connected = false;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withBackoff(fn, label, maxAttempts = 30) {
  let attempt = 0;
  let delay = 1000;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      console.error(`[kafka:${label}] attempt ${attempt} failed:`, err.message || err);
      await sleep(Math.min(delay, 60000));
      delay = Math.min(delay * 2, 60000);
    }
  }
  throw new Error(`[kafka:${label}] gave up after ${maxAttempts} attempts`);
}

async function ensureTopic() {
  await withBackoff(async () => {
    await admin.connect();
    try {
      await admin.createTopics({
        topics: [
          {
            topic: 'location-events',
            numPartitions: 3,
            replicationFactor: 1,
            configEntries: [
              { name: 'retention.ms', value: '3600000' },
            ],
          },
        ],
        waitForLeaders: true,
      });
    } catch (e) {
      if (!String(e.message || e).includes('already exists')) {
        throw e;
      }
    } finally {
      await admin.disconnect();
    }
  }, 'ensureTopic');
}

async function connectProducer() {
  if (connected) return;
  await withBackoff(async () => {
    await ensureTopic();
    await producer.connect();
    connected = true;
    console.log('[kafka:producer] connected');
  }, 'producer');
}

async function publishLocationEvent(payload) {
  if (!connected) {
    await connectProducer();
  }
  const { userId, name, avatar, lat, lng, timestamp, socketId } = payload;
  const value = JSON.stringify({
    userId,
    name,
    avatar,
    lat,
    lng,
    timestamp,
    socketId,
  });

  await producer.send({
    topic: 'location-events',
    messages: [
      {
        key: String(userId),
        value,
      },
    ],
  });
}

async function disconnectProducer() {
  if (connected) {
    await producer.disconnect();
    connected = false;
  }
}

module.exports = {
  kafka,
  producer,
  connectProducer,
  publishLocationEvent,
  disconnectProducer,
  withBackoff,
};
