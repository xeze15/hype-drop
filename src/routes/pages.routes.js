'use strict';

const express = require('express');
const { requireAuthPage, requireAdminPage } = require('../auth');
const { Targets } = require('../models');
const scheduler = require('../monitor/scheduler');

const router = express.Router();

router.get('/', requireAuthPage, (req, res) => {
  res.render('dashboard', {
    title: 'Dashboard',
    targets: Targets.all().map(scheduler.publicTarget),
  });
});

router.get('/admin', requireAuthPage, requireAdminPage, (req, res) => {
  res.render('admin', {
    title: 'Admin',
    monitor: scheduler.getMonitorSettings(),
  });
});

router.get('/profile', requireAuthPage, (req, res) => {
  res.render('profile', { title: 'Profile' });
});

module.exports = router;
