# HDFC ERGO standalone module — FROZEN REFERENCE

This is the original standalone Express integration for HDFC ERGO Private Car,
written before HDFC was ported into the `tf-api` provider adapter pattern.

**It is not wired into anything and is not run.** It is kept only so the ported
mapper can be diffed against the payload construction that was verified against
HDFC UAT.

The live integration lives in `tf-api/src/providers/hdfc/`.
Vendor quirks and open confirmations are documented in
`tf-api/docs/hdfc-integration-notes.md`.

## Known inconsistency (historical caution)

`backend/data/schema.sql` declares `model_master` / `rto_master`, while
`backend/services/hdfcMmvService.js` and `hdfcRtoService.js` query `hdfcmmv` /
`hdfcrto_master`. Neither pair exists in `tf_api_dev`. The canonical
`mmv_master` / `rto_master` + `provider_*_codes` tables replace both.
