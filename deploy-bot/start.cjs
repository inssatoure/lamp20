// LAMP AI — startup file for cPanel "Setup Node.js App" (LiteSpeed / Passenger).
// The host loads the startup file with require(); app.js is an ES module with top-level await,
// which require() cannot load. This file loads it the modern way.
import('./app.js').catch((e) => { console.error(e); process.exit(1); });
