let bot = null;

module.exports = {
  set: (b) => { bot = b; },
  get: () => bot,
};
