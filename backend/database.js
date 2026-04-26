const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);

db.defaults({
  users: [],
  services: [],
  orders: [],
  reviews: [],
  _nextServiceId: 1,
  _nextOrderId: 1,
  _nextReviewId: 1,
}).write();

const makeIdGetter = (key) => () => {
  const id = db.get(key).value();
  db.set(key, id + 1).write();
  return id;
};

db.getNextServiceId = makeIdGetter('_nextServiceId');
db.getNextOrderId   = makeIdGetter('_nextOrderId');
db.getNextReviewId  = makeIdGetter('_nextReviewId');

module.exports = db;
