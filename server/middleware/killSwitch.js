// KILLSWITCH DISABLED — All code commented out, not deleted.
// To re-enable, uncomment everything below.

// const fetch = require('node-fetch');
//
// const LICENSE_URL = 'https://license-server-six-ivory.vercel.app/api/check?clientId=bhdt-client';
//
// const killSwitch = async (req, res, next) => {
//   // SAFETY NET OVERRIDE: 
//   // If explicitly set to 'true' in your .env or Vercel dashboard, ignore the license server entirely.
//   if (process.env.SERVICE_ACTIVE === 'true') {
//     return next();
//   }
//
//   try {
//     const response = await fetch(LICENSE_URL);
//     const data = await response.json();
//
//     if (!data.active) {
//       return res.status(402).json({
//         suspended: true,
//         amount: data.amount,
//         message: 'Service suspended due to outstanding payment.',
//         contact: 'your@email.com'
//       });
//     }
//   } catch (err) {
//     return res.status(402).json({
//       suspended: true,
//       amount: '',
//       message: 'Service unavailable.'
//     });
//   }
//
//   next();
// };
//
// module.exports = killSwitch;

// Passthrough — does nothing, just calls next()
const killSwitch = (req, res, next) => next();
module.exports = killSwitch;