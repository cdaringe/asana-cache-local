[![Codeship Status for cdaringe/asana-cache-local](https://codeship.com/projects/a2af4ee0-2664-0133-c165-42218616331f/status?branch=master)](https://codeship.com/projects/97075)

# asana-cache-local
cache all tasks within an [asana](http://asana.com/) workspace, onto your local machine.  caches _only_ tasks that have been assigned.  tasks are all stored in a single KV store. `cache.refresh()` uses the asana incrimental API, and only pulls down updates on tasks since they have last been modified, or new tasks since the store has last been updated. :)

```js
// example
var asana = require('asana');
var client = asana.Client.create().useBasicAuth('your-api-key');
var Cacher = require('asana-cache-local');
var cacher = new Cache({
    client: client,
    workspace: 123456789,
    verbose: true
});
var log = function() { console.dir(arguments); };

cacher.refresh()
    .then(function() {
        cacher.tasks.all().then(log); // show all tasks!
        cacher.users.all().then(log); // show all users!
    });
```

# api

## constructor // new Cacher(opts)
- @param {object} opts
- @option {number} workspace - id of tasks to cache
- @option {object} client - asana api client, with authorization set
- @options {string=} dbpath - folder to store local database dbs/caches
- @option {boolean=} verbose - enable logging of non-error/warning events
    - @default _undefined_
- @option {string=} fields to include in task. must be formatted (kind of goofyish, as done with the @default below)
    - @default 'completed,completed_at,created_at,due_on,assignee_status,modified_at,parent,notes,name'

### properties
- @property tasks - [PouchDB-Wrapper](https://github.com/cdaringe/pouchdb-wrapper) datastore of asana tasks
- @property users - [PouchDB-Wrapper](https://github.com/cdaringe/pouchdb-wrapper)  of asana users

## methods

### refresh
Downloads all of the assigned tasks from the workspace, user-by-user, and stores them in a local db.  On subsequent calls, tasks fetched that are new/updated are only recieved from the point of last update (so it speeds up after first run).
- @return {proimse}
- @resolves {undefined}

### loadUsersToCache()
Loads the users onto the cache for ease of access.  Users can be accessed via `cacher.cache.users` (array), or `cacher.cache.usersById` (object indexed by user id)
- @return {promise}
- @resolves {array} list of users
```js
var promise1 = cacher.tasks.all();
var promise2 = cacher.loadUsersToCache();
Promise.all([promise1, promise2]).then(function assignNamesToAssignees(r) {
    var tasks = r[0];
    var users = r[1];
    tasks.forEach(function(task) {
        /* cacher.cache.usersById = {
         *    12345678: 'bill brasky',
         *    ...
         * }
         */
        task.assignmeeName = cacher.cache.usersById[task.assignee];
    });
})
```
