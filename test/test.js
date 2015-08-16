'use strict';
// tests perform _no_ mocking ATM. must provide real workspace and have assigned tasks
var test = require('tape');
var config = require('config');
var asana = require('asana');
var moment = require('moment')
var client = asana.Client.create().useBasicAuth(config.apikey);
var dummyUsers = [{ id: 8701585143073, lastUpdate: moment().format(), name: 'bill brasky' }];
var dummyTasks = [{ id: 10007255869124,  created_at: '2014-02-04T00:11:10.055Z',  modified_at: '2015-08-03T20:19:40.835Z',  name: 'abc',  notes: '',  completed: false,  assignee_status: 'upcoming',  completed_at: null,  due_on: null,  parent: null,  assignee: 8701585143073  }];
client.users.findAll = function() { return Promise.resolve({ data: dummyUsers, _response: {} }); };
client.tasks.findAll = function() { return Promise.resolve({ data: dummyTasks, _response: {} }); };
var Cacher = require('../index.js');
var log = function() { console.dir(arguments); };

var cacher = new Cacher({
    client: client,
    dbpath: 'test/db',
    workspace: config.workspace,
    verbose: true
});

test('constructor', function(t) {
    // silly placeholder tests
    t.ok(cacher.tasks, 'has tasks db');
    t.ok(cacher.users, 'has users db');
    t.end();
});

test('refresh', function(t) {
    t.plan(3);
    // test that data is in db post-refresh
    cacher.refresh().then(function() {
        return cacher.tasks.all();
    })
    .then(function(tasks) {
        t.ok(Array.isArray(tasks), 'list of tasks returned');
        t.ok(tasks.length, 'tasks stored');
    })
    // test that updated data is reflected as updated
    .then(function() {
        dummyTasks = [{ id: 10007255869124,  created_at: '2014-02-04T00:11:10.055Z',  modified_at: '2015-08-03T20:19:40.835Z',  name: 'efg',  notes: '',  completed: false,  assignee_status: 'upcoming',  completed_at: null,  due_on: null,  parent: null,  assignee: 8701585143073  }];
        return cacher.refresh();
    })
    .then(function() { return cacher.tasks.all(); })
    .then(function(tasks) {
        t.equal('efg', tasks[0].name, 'modified tasks updated in db');
    })
    .then(t.end)
    .catch(function(err) { console.dir(err); t.fail(); });
});
