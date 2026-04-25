const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);

db.defaults({
  users: [],
  listings: [],
  transactions: [],
  _nextListingId: 1,
  _nextTransactionId: 1,
}).write();

db.getNextListingId = () => {
  const id = db.get('_nextListingId').value();
  db.set('_nextListingId', id + 1).write();
  return id;
};

db.getNextTransactionId = () => {
  const id = db.get('_nextTransactionId').value();
  db.set('_nextTransactionId', id + 1).write();
  return id;
};

module.exports = db;
