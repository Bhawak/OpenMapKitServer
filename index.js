'use strict';

var settings;

try {
    settings = require('./settings');
} catch (e) {
    console.error("You must have a settings.js file. Take a look at settings.js.example. https://github.com/AmericanRedCross/OpenMapKitServer/blob/master/settings.js.example");
    process.exit();
}

var express = require('express');
var bodyParser = require('body-parser');
var directory = require('serve-index');
var cors = require('cors');
var passport = require('passport');
var BasicStrategy = require('passport-http').BasicStrategy;
var DigestStrategy = require('passport-http').DigestStrategy;
var LocalStrategy = require('passport-local').Strategy;

var odkOpenRosa = require('./api/odk/odk-openrosa-routes');
var odkAggregate = require('./api/odk/odk-aggregate-routes');
var deployments = require('./api/deployments/deployment-routes');
var error = require('./api/odk/controllers/error-handler');
var pkg = require('./package');
var authentication = require('./util/auth');
var adminDVPermission = require('permission')(['admin', 'data-viewer']);

var app = express();

var noAuth = (req, res, next) => next();
var auth = (req, res, next) => {
  if (req.user && req.user.username) {
    return next();
  } else {
    passport.authenticate(
      ['local', 'basic', 'digest'],
      function(err, user, info) {
        if (err) return next(err);
        if (!user) {
          return res.status(403).json({
            message: "access forbidden"
          });
        }
        // Manually establish the session...
        req.login(user, function(err) {
          if (err) return next(err);
          return next();
        });
      },
      { session: false }
    )(req, res, next);
  }
};

passport.use(new BasicStrategy(
  function(username, password, cb) {
    authentication.findByUsername(username, function(err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false); }
      if (user.password != password) { return cb(null, false); }
      return cb(null, user);
    });
}));
passport.use(new DigestStrategy({ qop: 'auth' },
  function(username, password, cb) {
    authentication.findByUsername(username, function(err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false); }
      return cb(null, user, user.password);
    });
}));
passport.use(new LocalStrategy(
  function(username, password, cb) {
    authentication.findByUsername(username, function(err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false); }
      if (user.password != password) { return cb(null, false); }
      return cb(null, user);
    });
}));
passport.serializeUser(function(user, cb) {
  cb(null, user.id);
});

passport.deserializeUser(function(id, cb) {
  authentication.findById(id, function (err, user) {
    if (err) { return cb(err); }
    cb(null, user);
  });
});

// Enable CORS always.
app.use(cors());

// Body parser
app.use(require('morgan')('combined'));
app.use(require('cookie-parser')());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  require('express-session')(
    { secret: 'keyboard cat', resave: false, saveUninitialized: false }
  )
);
app.use(passport.initialize());
app.use(passport.session());

// Basic Info
app.get('/', redirectToForms);
app.get('/omk', redirectToForms);
app.get('/omk/info', info);

app.get('/current-user',
  function(req, res) {
    if (req.user) {
      res.json({ username: req.user.username, role: req.user.role});
    } else {
      res.status(401).json({error: 'User not authenticated'});
    }
  }
);

app.post('/login', function(req, res, next) {
  console.log(req.body);
  if (req.body.username && req.body.password) {
    authentication.findByUsername(req.body.username, function(err, user) {
      if ((err || !user) && user.password !== req.body.password) {
        console.log('user: ' + user + '\n '+ req.body);
        err = new Error('Wrong username or password.');
        err.status = 401;
        return next(err);
      } else {
        req.session.userId = user.id;
        res.status(200).json({
          user:user,
          message:'Authenticated',
          auth:"1"
        });
      }
    });
  }
});

app.get('/logout', function(req, res, next) {
    req.logout();
    res.status(200).json({
      message:'Logged Out',
      auth:"0"
    });
});

// Open Data Kit OpenRosa

// It's better to stay on top level of routes to
// prevent the user from having to add a prefix in ODK Collect
// server path.
app.use('/formList', noAuth);
app.use('/view', noAuth);
app.use('/', odkOpenRosa);

/**
 * Authentication routes.
 *
 * Note that OpenRosa routes pass through without auth.
 * We can't lock down /omk/data/forms route, because that
 * breaks /formList
 */
app.use('/omk/odk', auth);

// Open Data Kit Aggregate

// These are endpoints that are used by iD and other pages.
// They are used to aggregate ODK and OSM data, and they
// do not need to be OpenRosa spec'ed like the endpoints
// interacted with in ODK Collect.
app.use('/omk/odk', odkAggregate);

// Deployments
app.use('/omk/deployments', deployments);

// Public Data & Static Assets
app.use('/omk/data', express.static(settings.dataDir));
app.use('/omk/data', directory(settings.dataDir));
app.use('/omk/data/submissions', adminDVPermission);
app.use('/omk/pages', express.static(settings.pagesDir));
app.use('/omk/pages', directory(settings.pagesDir));
// Handle errors
app.use(error);

module.exports = app;

function info(req, res) {
  res.status(200).json({
    name: settings.name,
    description: settings.description,
    status: 200,
    service: 'omk-server',
    npm: pkg.name,
    version: pkg.version
  });
}

function redirectToForms(req, res, next) {
    res.redirect('/omk/pages');
}
