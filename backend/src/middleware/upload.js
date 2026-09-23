const multer = require('multer');
const { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } = require('../config/constants');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only .xlsx, .xls and .csv files are allowed.'), { status: 400 }));
    }
    cb(null, true);
  },
});

module.exports = upload;
