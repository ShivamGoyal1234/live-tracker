const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { pool } = require('../db/pool');

function configurePassport() {
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  const clientID = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  const callbackURL = process.env.CALLBACK_URL || 'http://localhost:3000/auth/google/callback';

  if (!clientID || !clientSecret) {
    console.warn(
      '[auth] OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET missing — Google login disabled until configured.',
    );
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const oauthProvider = 'google';
          const oauthId = profile.id;
          const name =
            profile.displayName ||
            (profile.name && profile.name.givenName) ||
            'User';
          const avatarUrl =
            profile.photos && profile.photos[0] ? profile.photos[0].value : null;

          const existing = await pool.query(
            `SELECT id, name, avatar_url FROM users WHERE oauth_provider = $1 AND oauth_id = $2`,
            [oauthProvider, oauthId],
          );

          if (existing.rows.length > 0) {
            const row = existing.rows[0];
            await pool.query(
              `UPDATE users SET name = $1, avatar_url = $2 WHERE id = $3`,
              [name, avatarUrl, row.id],
            );
            return done(null, {
              id: row.id,
              name,
              avatar: avatarUrl,
            });
          }

          const inserted = await pool.query(
            `INSERT INTO users (oauth_provider, oauth_id, name, avatar_url)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, avatar_url`,
            [oauthProvider, oauthId, name, avatarUrl],
          );

          const u = inserted.rows[0];
          return done(null, {
            id: u.id,
            name: u.name,
            avatar: u.avatar_url,
          });
        } catch (err) {
          return done(err);
        }
      },
    ),
  );
}

module.exports = { configurePassport };
