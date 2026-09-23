/** Centralized error handler - keeps controllers thin (section 26/34). */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.response?.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({
    error: {
      code,
      message: err.message || 'Unexpected error',
    },
  });
}

module.exports = errorHandler;
