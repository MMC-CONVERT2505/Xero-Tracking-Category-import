/**
 * @typedef {Object} XeroConnection   (stored under a generated connectionId)
 * @property {Object} tokenSet         { access_token, refresh_token, expires_in, obtainedAt, ... }
 * @property {Array<{id:string, tenantId:string, tenantName:string, tenantType:string}>} connections
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * One connectionId is created per successful OAuth login and may cover
 * several Xero organisations at once (Xero returns them all from
 * GET /connections after token exchange). See services/xeroConnectionService.js
 * for why the token set is shared, not duplicated, across those tenants -
 * and db/store.js's tenantIndex.json for the tenantId -> connectionId map
 * background import jobs use.
 */
module.exports = {};
