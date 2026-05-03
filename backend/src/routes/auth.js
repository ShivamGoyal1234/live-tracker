const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../auth/middleware');

const router = express.Router();

function issueJwt(user) {
  const payload = {
    userId: user.id,
    name: user.name,
    avatar: user.avatar || '',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

router.get('/google', (req, res, next) => {
  if (!process.env.OAUTH_CLIENT_ID) {
    return res.status(503).send('OAuth is not configured. Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET.');
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=oauth' }),
  (req, res) => {
    const token = issueJwt(req.user);
    const encoded = encodeURIComponent(token);
    res.redirect(`/?token=${encoded}`);
  },
);

router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

module.exports = router;
module.exports.issueJwt = issueJwt;
