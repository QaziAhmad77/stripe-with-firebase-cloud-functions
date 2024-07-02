/* eslint-disable no-undef */
require('dotenv').config();
const express = require('express');
const router = require('./routes');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
app.use(
  bodyParser.json({
    verify: function (req, res, buf) {
      req.rawBody = buf;
    },
  })
);
app.use(bodyParser.json());
app.use(express.json());
app.use(cors());
app.use('/', router);
app.listen(7000, () => {
  console.log('Server started on port 7000');
});
