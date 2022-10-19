const { DateTime } = require('luxon');
const path = require('path');

const today = DateTime.now().toFormat('yyyyMMdd');

const getDaysHeld = (acquired, sold) => {
  const end = DateTime.fromJSDate(new Date(sold));
  const start = DateTime.fromJSDate(new Date(acquired));

  const diffInDays = end.diff(start, 'days');
  const { days } = diffInDays.toObject();
  return Math.ceil(days);
};

const timestamp = DateTime.now().valueOf();

const projectFolder = process.pkg ? path.dirname(process.execPath) : __dirname;

const filesPath = process.pkg ? projectFolder : path.join(projectFolder, 'files');
const activityFilesPath = process.pkg ? projectFolder : path.join(projectFolder, 'activityFiles');

module.exports = {
  today,
  getDaysHeld,
  timestamp,
  projectFolder,
  filesPath,
  activityFilesPath,
};
