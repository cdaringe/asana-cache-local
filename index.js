'use strict';
var PouchW = require('pouchdb-wrapper');
var moment = require('moment');
var indexBy = require('lodash.indexby');

var AsanaTaskCacher = function(opts) {
    opts = opts || {};
    this.workspace = parseInt(opts.workspace, 10);
    if (!this.workspace || typeof this.workspace !== 'number') {
        throw new ReferenceError('asana workspace required');
    }
    this.client = opts.client;
    if (!this.client || !this.client.users) {
        throw new ReferenceError('invalid asana client provided');
    }
    if (opts.verbose) {
        this.verbose = true;
    }

    this.taskFields = opts.taskFields || 'completed,completed_at,created_at,due_on,assignee_status,modified_at,parent,notes,name';

    this.users = new PouchW({ name: 'db-users', path: opts.dbpath }); // [{ userId: 123, lastUpdate: 8601 }]
    this.tasks = new PouchW({ name: 'db-tasks', path: opts.dbpath });

    this.cache = {};
};

/**
 * Reads all users in the workspace from the API, ensures that they are
 * in our cached user datastore, then refreshes all tasks for each user
 * from the last point in time that we `refresh`ed.
 * @return {promise}
 * @resolves {undefined}
 */
AsanaTaskCacher.prototype.refresh = function() {
    var client = this.client;
    var usersdb = this.users;
    var self = this;
    var allTasksReady = this.tasks.all();
    return client.users.findAll({
        workspace: this.workspace
    })

    .then(function(users) {
        return users.data; // [{ (user)id: 2342, name: 'chris d'}]
    })

    .then(function(users) {
        return this._putUsers(users);
    }.bind(this))

    .then(function(users) {
        return allTasksReady
        .then(function(allTasks) {
            var allTasksById = indexBy(allTasks, 'id');
            return users.reduce(function(chain, user, ndx, arr) {
                return chain
                .then(function() {
                    return self._refreshUserTasks(user, allTasksById);
                });
            }, Promise.resolve());
        });
    })

    .then(function() {
        this.verbose && console.log('tasks updated successfully');
    }.bind(this))
    .catch(function(err) {
        console.dir(err);
        if (err && err.value && err.value.errors) {
            console.dir(err.value.errors);
        }
        throw err;
    });
};

/**
 * Fetches all user tasks from the API since the last time we refreshed the user,
 * then adds all new and modified tasks to the datastore.  After
 * @param  {object} user
 * @return {promise}
 * @resolves {undefined}
 */
AsanaTaskCacher.prototype._refreshUserTasks = function(user, prevTasksById) {
    // mark the time we begin updating
    var updateStartTime = moment();
    var usersdb = this.users;
    var tasksdb = this.tasks;

    // master promise, indicating all tasks have been fetched and stored to DB,
    // as well as user status lastUpdated timestamp updated
    var resolve, reject;
    var tasksUpdated = new Promise(function(res, rej) { resolve = res; reject = rej; });

    // container for _all_ user data (since last update), post-paginating thru API src'd data
    var allData = [];

    // support utilities for staging all paginated data, prior to posting into database
    var resolveAllPages, rejectAllPages;
    var pageCount = 0;
    var allPagesAppended = new Promise(function(res, rej) { resolveAllPages = res; rejectAllPages = rej; });
    var append = function(task) {
        task._id = task.id.toString();
        task.assignee = user.id;
        allData.push(task);
    };
    var getNextPage = function(page) {
        var response = page._response;
        if (!page) { rejectAllPages('no page found'); return; }
        if (!page.data) { rejectAllPages('no page data found'); return; }
        if (!response) { rejectAllPages('no response found'); return; }
        ++pageCount;
        this.verbose && console.log('page of tasks for', user.name, 'page:', pageCount, '(', page.data.length, 'tasks', ')');
        page.data.forEach(append);
        if (response.next_page) {
            return page.nextPage().then(getNextPage, rejectAllPages);
        }
        resolveAllPages();
    }.bind(this);

    // go
    var query = {
        workspace: this.workspace,
        assignee: user.id,
        opt_fields: this.taskFields,
        limit: 100,
        modified_since: user.lastUpdated || moment(0).format()
    };
    this.client.tasks.findAll(query)
    .then(function appendUserAndDbIdToTasks(page) {
        getNextPage(page);
        return allPagesAppended;
    }).then(function(tasks) {
        allData.forEach(function setRevIfPreExisting(task) {
            if (prevTasksById[task.id]) {
                task._rev = prevTasksById[task.id]._rev;
            }
        });
        return tasksdb.bulkDocs(allData)
        .catch(function(err) {
            console.error('total effing error');
        })
        .then(function updateUserLastUpdatedTime() {
            return usersdb.get(user.id.toString())
            .then(function updateStatus(user) {
                user.lastUpdated = updateStartTime.format();
                return usersdb.update(user).then(resolve);
            });
        })
    });
    return tasksUpdated;
};

/**
 * Store (or assert) users into the local cache
 * @param  {array} users [array, of, users]
 * @return {promise}
 * @resolve users
 */
AsanaTaskCacher.prototype._putUsers = function(users) {
    var resolve, reject;
    var usersdb = this.users;
    var usersP = new Promise(function(res, rej) { resolve = res; reject = rej; });
    var usersCreated = users.map(function(user) {
        return usersdb.get(user.id.toString())
        .catch(function(err) {
            if (err.status === 404) {
                this.verbose && console.log('Adding new user: ' + user.name + ' (' + user.id + ')');
                return usersdb.add({
                    _id: user.id.toString(),
                    id: user.id,
                    name: user.name
                });
            }
            console.error('unable to fetch user from user/user-status db');
            console.log(err);
            throw err;
        }.bind(this));
    }.bind(this));
    Promise.all(usersCreated).then(function() {
        usersdb.all().then(function(users) {
            resolve(users);
        });
    }.bind(this));
    return usersP;
};

/**
 * Loads the users onto the cache for ease of access.  Users can be
 * accessed via .cache.users (array), or .cache.usersById (object indexed
 * by user id)
 * @return {promise}
 * @resolves list of users in db
 */
AsanaTaskCacher.prototype.loadUsersToCache = function() {
    return this.users.all().then(function(users) {
        this.cache.users = users;
        this.cache.usersById = {};
        users.forEach(function(user) {
            this.cache.usersById[user.id] = user;
        }.bind(this));
        return users;
    }.bind(this));
};

module.exports = AsanaTaskCacher;
