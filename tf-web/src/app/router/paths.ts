/**
 * Every route path in the app. Components must import from here instead of
 * hardcoding strings. Paths are preserved verbatim from the legacy app
 * (including casing like /PetSetpOne) so old links keep working.
 */
export const ROUTES = {
  home: "/",
  homepage: "/homepage",
  ecommerceHome: "/ecomarceHome",
  termsAndConditions: "/TermsAndConditions",
  lifeInsurance: "/lifeinsurance",

  auth: {
    login: "/login",
    signup: "/signup",
    newLogin: "/newlogin/:mobile",
    newLoginFor: (mobile: string) => `/newlogin/${mobile}`,
  },

  petServices: {
    shop: "/shop",
    buy: "/buy",
    cart: "/cart",
    booking: "/booking",
    createPackage: "/create-package",
    serviceHistory: "/service-history",
    notifications: "/notification",
    petTracking: "/pet-tracking",
    qrScanner: "/qr-scanner",
  },

  vehicle: {
    // two wheeler journey
    start: "/Vehicle",
    confirmDetails: "/Vehicle_Second",
    coverage: "/VehicleThird",
    coverageHizuno: "/VehicleThirdHizuno",
    coverageHdfc: "/VehicleThirdHdfc",
    quotes: "/Payment",
    hizunoCheckout: "/hizuno-checkout",
    editNumber: "/EditVehicleNo",
    editCity: "/EditVehiclecity",
    editYear: "/EditVehicleYear",
    selectVehicle: "/SelectVehicle",
    selectModel: "/SelectVehicleModel",
    selectVariant: "/vehicleVariants",
    bikeLoader: "/bikeloader",
    // car journey
    carStart: "/Vehicle_Car",
    apiForm: "/ApiForm",
    bikePay: "/BikePay",
    kycStatus: "/kycstatus",
    paymentPage: "/PaymentPage",
    // insurer specific
    bajajKyc: "/bajaj-kyc",
    bajajCreateQuote: "/bajaj_createquote",
    goDigitForm: "/api_form_godigit",
    hdfcKyc: "/hdfc-kyc",
    hdfcApiForm: "/hdfc-api-form",
    zunoCreateQuote: "/zuno_createquote",
    zunoKyc: "/zuno-kyc",
    zunoNwCheckout: "/zuno-nw-checkout",
    // new vehicle journey
    newCar: "/new_car",
    newBike: "/new-bike-details",
    newViewDetails: "/New_ViewDetails",
    newQuotes: "/new-vehicle-quotes",
    newCreateQuote: "/new-createquote",
    newKyc: "/nw_kyc",
    // new commercial journey
    newCommercial: "/new-commercial",
    newCommercialDetails: "/enter-new-commercial-details",
    newCommercialQuotes: "/newcomm_quickquote",
    newCommercialCreateQuote: "/new-comm-create-quote",
    newCommercialKyc: "/zuno-new-comm-kyc",
  },

  health: {
    start: "/Health",
    city: "/HealthCity",
    info: "/HealthInfo",
    multiPolicy: "/HealthMultiPolicy",
    medical: "/HealthMedical",
    wrapper: "/HealthWrapper",
    multiInc: "/Health_multi_inc",
    age: "/HealthAge",
    groupHealth: "/Group_Health",
    groupHealthAge: "/Group_HealthAge",
    multi: "/HealthMulti",
    filter: "/Filter",
    plan: "/HealthPlan",
    formFirst: "/HealthFormFirst",
    formSecond: "/HealthFormSecond",
    formThird: "/HealthFormThird",
    formFour: "/HealthFormFour",
    medicalFirst: "/HealthMedicalFirst",
    medicalSecond: "/HealthMedicalSecond",
    nominee: "/HealthNominee",
    checkout: "/HealthCheckout",
  },

  pet: {
    start: "/Pet",
    idv: "/Idv",
    home: "/PetHome",
    stepOne: "/PetSetpOne",
    info: "/PetInfo",
    stepTwo: "/PetStepTwo",
    stepThree: "/PetStepThree",
    stepFour: "/PetStepFour",
    stepFive: "/PetStepFive",
    buy: "/PetBuy",
    priceCompare: "/PetPriceCompare",
    paymentSuccess: "/pet-payment-success",
    bajajPaymentSuccess: "/petbajajsuccess",
  },

  postSale: {
    endorsements: "/endorsements",
    claimsIntimation: "/claims-intimation",
    renewals: "/renewals",
    grievance: "/grievance",
    claimNew: "/claim/new-claim",
    claimAlreadyFiled: "/claim/already-filed-claim",
    claimFiling: "/claim/filing-claim",
    claimTrack: "/claim/track-exising-claim",
  },

  checkout: {
    main: "/checkout",
    otp: "/otp",
    formPage: "/FormPage",
    paymentDone: "/PymentDone",
    paymentSuccess: "/payment-success",
    paymentSummary: "/payment-summary",
    insurancePaymentSuccess: "/insurance_ps",
    hdfcSuccess: "/success",
    hdfcFailure: "/failure",
    bajajPaymentSuccess: "/bajaj-payment-success",
  },

  account: {
    profile: "/Profile",
    editProfile: "/EditProfile",
    editProfileData: "/EditProfileData",
    myPolicy: "/MyPolicy",
    wallet: "/wallet",
    support: "/support",
    supportHelp: "/support/help",
    supportTerms: "/support/account/terms-and-conditions",
    dashboardLogin: "/DashboardLogin",
    dashboardHome: "/DashboardHome",
    afterLogDash: "/AfterLogDash",
  },

  misc: {
    loader: "/loader",
  },
} as const;

/** Manual new-vehicle (no RC yet) entry route, keyed by supported category. */
export const NEW_VEHICLE_ROUTES = {
  twoWheeler: ROUTES.vehicle.newBike,
  fourWheeler: ROUTES.vehicle.newCar,
  commercial: ROUTES.vehicle.newCommercialDetails,
} as const;
