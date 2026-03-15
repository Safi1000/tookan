// middleware/killSwitch.js
const fetch = require('node-fetch');

const LICENSE_URL = 'https://license-server-six-ivory.vercel.app/api/check?clientId=bhdt-client';

const killSwitch = async (req, res, next) => {
  try {
    const response = await fetch(LICENSE_URL);
    const data = await response.json();

    if (!data.active) {
      return res.status(402).json({
        suspended: true,
        message: 'Service suspended due to outstanding payment. Please contact the developer.',
        contact: 'your@email.com'
      });
    }
  } catch (err) {
    return res.status(402).json({
      suspended: true,
      message: 'Service unavailable.'
    });
  }

  next();
};

module.exports = killSwitch;