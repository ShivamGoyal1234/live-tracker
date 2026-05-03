const { Kafka, logLevel } = require('kafkajs');
const { withBackoff } = require('./producer');

function createSocketBroadcasterConsumer(io) {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const kafka = new Kafka({
    clientId: 'location-server-socket-broadcaster',
    brokers,
    logLevel: logLevel.WARN,
  });

  const consumer = kafka.consumer({
    groupId: 'socket-broadcaster',
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });

  async function run() {
    await withBackoff(async () => {
      await consumer.connect();
      await consumer.subscribe({
        topic: 'location-events',
        fromBeginning: false,
      });
    }, 'socketConsumerConnect');

    console.log('[kafka:socket-broadcaster] consumer connected; broadcasting live events');
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const raw = message.value && message.value.toString();
          if (!raw) return;
          const data = JSON.parse(raw);
          const { userId, name, avatar, lat, lng, timestamp } = data;
          io.emit('location:broadcast', {
            userId,
            name,
            avatar,
            lat,
            lng,
            timestamp,
          });
        } catch (err) {
          console.error('[kafka:socket-broadcaster] eachMessage error:', err.message || err);
        }
      },
    });
  }

  async function stop() {
    try {
      await consumer.disconnect();
    } catch (e) {
      console.error('[kafka:socket-broadcaster] disconnect error', e);
    }
  }

  return { run, stop };
}

module.exports = { createSocketBroadcasterConsumer };
