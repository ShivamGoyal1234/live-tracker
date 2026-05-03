const { Kafka, logLevel } = require('kafkajs');
const { withBackoff } = require('./producer');
const { pool } = require('../db/pool');

const FLUSH_MS = 2000;

function createDbWriterConsumer() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const kafka = new Kafka({
    clientId: 'location-server-db-writer',
    brokers,
    logLevel: logLevel.WARN,
  });

  const consumer = kafka.consumer({
    groupId: 'db-writer',
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });

  const buffer = [];
  let flushInterval = null;

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    const userIds = [];
    const lats = [];
    const lngs = [];
    const times = [];

    for (const row of batch) {
      userIds.push(row.userId);
      lats.push(row.lat);
      lngs.push(row.lng);
      times.push(row.recordedAt);
    }

    const sql = `
      INSERT INTO location_history (user_id, lat, lng, recorded_at)
      SELECT * FROM unnest($1::uuid[], $2::float8[], $3::float8[], $4::timestamptz[])
      ON CONFLICT (user_id, recorded_at) DO NOTHING
    `;

    try {
      await pool.query(sql, [userIds, lats, lngs, times]);
    } catch (err) {
      console.error('[kafka:db-writer] bulk insert error:', err.message || err);
    }
  }

  async function run() {
    flushInterval = setInterval(() => {
      flush().catch((e) => console.error('[kafka:db-writer] flush error', e));
    }, FLUSH_MS);

    await withBackoff(async () => {
      await consumer.connect();
      await consumer.subscribe({
        topic: 'location-events',
        fromBeginning: false,
      });
    }, 'dbConsumerConnect');

    console.log('[kafka:db-writer] consumer connected; batching writes every', FLUSH_MS, 'ms');
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const raw = message.value && message.value.toString();
          if (!raw) return;
          const data = JSON.parse(raw);
          const { userId, lat, lng, timestamp } = data;
          if (!userId || typeof lat !== 'number' || typeof lng !== 'number') return;
          buffer.push({
            userId,
            lat,
            lng,
            recordedAt: new Date(timestamp),
          });
        } catch (err) {
          console.error('[kafka:db-writer] eachMessage parse error:', err.message || err);
        }
      },
    });
  }

  async function stop() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    await flush();
    try {
      await consumer.disconnect();
    } catch (e) {
      console.error('[kafka:db-writer] disconnect error', e);
    }
  }

  return { run, stop };
}

module.exports = { createDbWriterConsumer };
