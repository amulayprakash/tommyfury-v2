-- CreateTable
CREATE TABLE `providers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(64) NOT NULL,
    `displayName` VARCHAR(255) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `capabilities` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `providers_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(64) NOT NULL,
    `providerSlug` VARCHAR(64) NOT NULL,
    `vehicleCategory` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `quoteNo` VARCHAR(128) NULL,
    `providerTransactionId` VARCHAR(128) NULL,
    `policyType` VARCHAR(32) NOT NULL,
    `kycId` VARCHAR(128) NULL,
    `policyNumber` VARCHAR(128) NULL,
    `policyStatus` VARCHAR(32) NULL,
    `paymentLink` VARCHAR(512) NULL,
    `clientId` VARCHAR(64) NULL,
    `applicationNo` VARCHAR(128) NULL,
    `receiptNo` VARCHAR(128) NULL,
    `paymentTranKey` VARCHAR(128) NULL,
    `paymentRefNo` VARCHAR(128) NULL,
    `pgType` VARCHAR(32) NULL,
    `holderName` VARCHAR(255) NULL,
    `holderEmail` VARCHAR(255) NULL,
    `holderMobile` VARCHAR(20) NULL,
    `makeModel` VARCHAR(255) NULL,
    `registrationNo` VARCHAR(32) NULL,
    `engineNumber` VARCHAR(64) NULL,
    `chassisNumber` VARCHAR(64) NULL,
    `idvValue` INTEGER NULL,
    `netPremium` INTEGER NULL,
    `grossPremium` INTEGER NULL,
    `contractDetails` JSON NULL,
    `addonPremiums` JSON NULL,
    `discounts` JSON NULL,
    `rawRequest` JSON NULL,
    `rawFullQuote` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quotes_requestId_key`(`requestId`),
    INDEX `quotes_providerSlug_idx`(`providerSlug`),
    INDEX `quotes_status_idx`(`status`),
    INDEX `quotes_createdAt_idx`(`createdAt`),
    INDEX `quotes_providerTransactionId_idx`(`providerTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_quotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(64) NOT NULL,
    `providerSlug` VARCHAR(64) NOT NULL,
    `product` VARCHAR(32) NOT NULL,
    `line` VARCHAR(16) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `quoteNo` VARCHAR(128) NULL,
    `providerTransactionId` VARCHAR(128) NULL,
    `sumInsured` INTEGER NULL,
    `policyTermYears` INTEGER NOT NULL DEFAULT 1,
    `members` JSON NULL,
    `policyNumber` VARCHAR(128) NULL,
    `policyStatus` VARCHAR(32) NULL,
    `clientId` VARCHAR(64) NULL,
    `applicationNo` VARCHAR(128) NULL,
    `receiptNo` VARCHAR(128) NULL,
    `paymentTranKey` VARCHAR(128) NULL,
    `paymentRefNo` VARCHAR(128) NULL,
    `pgType` VARCHAR(32) NULL,
    `holderName` VARCHAR(255) NULL,
    `holderEmail` VARCHAR(255) NULL,
    `holderMobile` VARCHAR(20) NULL,
    `basePremium` INTEGER NULL,
    `netPremium` INTEGER NULL,
    `grossPremium` INTEGER NULL,
    `contractDetails` JSON NULL,
    `rawRequest` JSON NULL,
    `rawFullQuote` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `health_quotes_requestId_key`(`requestId`),
    INDEX `health_quotes_providerSlug_idx`(`providerSlug`),
    INDEX `health_quotes_product_idx`(`product`),
    INDEX `health_quotes_status_idx`(`status`),
    INDEX `health_quotes_providerTransactionId_idx`(`providerTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_product_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `line` VARCHAR(16) NOT NULL,
    `fgProduct` VARCHAR(64) NOT NULL,
    `fgMajorClass` VARCHAR(16) NOT NULL,
    `fgContractType` VARCHAR(16) NOT NULL,
    `fgPolicyType` VARCHAR(16) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `health_product_master_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_cover_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productCode` VARCHAR(32) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `minSumInsured` INTEGER NULL,
    `maxSumInsured` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `health_cover_master_productCode_idx`(`productCode`),
    UNIQUE INDEX `health_cover_master_productCode_code_key`(`productCode`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_occupation_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(16) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `fgCode` VARCHAR(16) NOT NULL,
    `paRiskClass` VARCHAR(8) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `health_occupation_master_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_relation_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(24) NOT NULL,
    `label` VARCHAR(64) NOT NULL,
    `fgCode` VARCHAR(8) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `health_relation_master_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rto_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(16) NOT NULL,
    `city` VARCHAR(128) NOT NULL,
    `state` VARCHAR(128) NOT NULL,
    `stateCode` VARCHAR(8) NOT NULL,
    `zone` VARCHAR(4) NULL,
    `source` VARCHAR(16) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `rto_master_code_key`(`code`),
    INDEX `rto_master_state_idx`(`state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mmv_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `makeId` VARCHAR(64) NOT NULL,
    `makeName` VARCHAR(128) NOT NULL,
    `modelId` VARCHAR(32) NOT NULL,
    `modelName` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(32) NULL,
    `variantName` VARCHAR(191) NULL,
    `fuelType` VARCHAR(32) NOT NULL,
    `engineCC` INTEGER NULL,
    `category` VARCHAR(32) NOT NULL,
    `bodyType` VARCHAR(64) NULL,
    `gvw` INTEGER NULL,
    `seatingCapacity` INTEGER NULL,
    `carryingCapacity` INTEGER NULL,
    `vehicleType` VARCHAR(191) NULL,
    `source` VARCHAR(16) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `mmv_master_makeName_idx`(`makeName`),
    INDEX `mmv_master_modelName_idx`(`modelName`),
    INDEX `mmv_master_category_idx`(`category`),
    INDEX `mmv_master_source_idx`(`source`),
    UNIQUE INDEX `mmv_master_makeId_modelId_variantId_fuelType_key`(`makeId`, `modelId`, `variantId`, `fuelType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `insurer_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `shortName` VARCHAR(64) NULL,
    `logoUrl` VARCHAR(512) NULL,
    `source` VARCHAR(16) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `insurer_master_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `motor_addons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerSlug` VARCHAR(64) NOT NULL,
    `category` VARCHAR(32) NOT NULL,
    `fuelClass` VARCHAR(16) NOT NULL DEFAULT 'standard',
    `code` VARCHAR(16) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `maxAgeYears` DOUBLE NULL,
    `requiresZeroDep` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `motor_addons_providerSlug_category_idx`(`providerSlug`, `category`),
    UNIQUE INDEX `motor_addons_providerSlug_category_fuelClass_code_key`(`providerSlug`, `category`, `fuelClass`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pincode_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pincode` VARCHAR(8) NOT NULL,
    `area` VARCHAR(191) NOT NULL,
    `city` VARCHAR(128) NOT NULL,
    `state` VARCHAR(128) NOT NULL,

    INDEX `pincode_master_pincode_idx`(`pincode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `occupation_master` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(16) NOT NULL,
    `description` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `occupation_master_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_rto_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerSlug` VARCHAR(64) NOT NULL,
    `rtoId` INTEGER NOT NULL,
    `providerCode` VARCHAR(64) NOT NULL,
    `line` VARCHAR(8) NOT NULL DEFAULT 'all',
    `verifiedAt` DATETIME(3) NULL,
    `verifyError` VARCHAR(255) NULL,

    UNIQUE INDEX `provider_rto_codes_providerSlug_rtoId_line_key`(`providerSlug`, `rtoId`, `line`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_mmv_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerSlug` VARCHAR(64) NOT NULL,
    `mmvId` INTEGER NOT NULL,
    `providerMakeCode` VARCHAR(64) NULL,
    `providerModelCode` VARCHAR(64) NULL,
    `providerVariantCode` VARCHAR(64) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifyError` VARCHAR(255) NULL,

    UNIQUE INDEX `provider_mmv_codes_providerSlug_mmvId_key`(`providerSlug`, `mmvId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `provider_insurer_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `providerSlug` VARCHAR(64) NOT NULL,
    `insurerId` INTEGER NOT NULL,
    `providerCode` VARCHAR(64) NOT NULL,

    UNIQUE INDEX `provider_insurer_codes_providerSlug_insurerId_key`(`providerSlug`, `insurerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_providerSlug_fkey` FOREIGN KEY (`providerSlug`) REFERENCES `providers`(`slug`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_rto_codes` ADD CONSTRAINT `provider_rto_codes_rtoId_fkey` FOREIGN KEY (`rtoId`) REFERENCES `rto_master`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_mmv_codes` ADD CONSTRAINT `provider_mmv_codes_mmvId_fkey` FOREIGN KEY (`mmvId`) REFERENCES `mmv_master`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `provider_insurer_codes` ADD CONSTRAINT `provider_insurer_codes_insurerId_fkey` FOREIGN KEY (`insurerId`) REFERENCES `insurer_master`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

