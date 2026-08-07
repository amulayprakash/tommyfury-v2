'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes');
const errorHandler = require('./utils/errorHandler');
const { ping } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'hdfc-ergo-integration', time: new Date().toISOString() }));

app.use('/api', routes);

app.use(errorHandler);

// Single startup guard — prevents the duplicate-listen issue.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`HDFC ERGO integration backend listening on http://localhost:${PORT}`);
    // Verify DB connection (hdfcmmv lookups depend on it).
    ping().catch((e) =>
      console.error('MySQL connection FAILED — check DB_* in .env:', e.message)
    );
  });
}

module.exports = app;
