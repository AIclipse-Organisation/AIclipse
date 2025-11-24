const express = require('express');
const jwt = require('jsonwebtoken');

const routes = require('./routes');

const app = express();

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;

function authFromHeader(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    req.user = null;
  }

  return next();
}

app.use(authFromHeader);
app.use('/', routes); 

module.exports = app;
