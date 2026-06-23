-- FG issuance binding + payment receipt (PolicyIssuance_Vendors).
ALTER TABLE `quotes`
    ADD COLUMN `clientId` VARCHAR(64) NULL,
    ADD COLUMN `applicationNo` VARCHAR(128) NULL,
    ADD COLUMN `receiptNo` VARCHAR(128) NULL,
    ADD COLUMN `paymentTranKey` VARCHAR(128) NULL,
    ADD COLUMN `paymentRefNo` VARCHAR(128) NULL,
    ADD COLUMN `pgType` VARCHAR(32) NULL;
