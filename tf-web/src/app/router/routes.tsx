import { lazy } from "react";
import type { RouteObject } from "react-router";

import { NotFoundPage } from "@/components/shared/not-found-page";
import { PlaceholderPage } from "@/components/shared/placeholder-page";
import { RouteErrorPage } from "@/components/shared/route-error-page";
import { AuthLayout } from "@/layouts/auth-layout";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { MainLayout } from "@/layouts/main-layout";
import { WizardLayout } from "@/layouts/wizard-layout";

import { ProtectedRoute, PublicRoute } from "./guards";
import { ROUTES } from "./paths";
import { RootLayout } from "./root-layout";

// Fully built pages are lazy-loaded; placeholder routes render inline.
const HomePage = lazy(() => import("@/features/home/home-page"));
const LoginPage = lazy(() => import("@/features/auth/pages/login-page"));
const SignupPage = lazy(() => import("@/features/auth/pages/signup-page"));
const NewLoginPage = lazy(() => import("@/features/auth/pages/new-login-page"));

// Vehicle insurance wizard (phase 2)
const VehicleNumberPage = lazy(() =>
  import("@/features/vehicle/pages/category-page").then((m) => ({ default: m.CategoryPage })),
);
const VehicleDetailsPage = lazy(() =>
  import("@/features/vehicle/pages/vehicle-details-page").then((m) => ({
    default: m.VehicleDetailsPage,
  })),
);
const VehicleComparePage = lazy(() =>
  import("@/features/vehicle/pages/compare-page").then((m) => ({ default: m.ComparePage })),
);
const VehicleProposalPage = lazy(() =>
  import("@/features/vehicle/pages/proposal-page").then((m) => ({ default: m.ProposalPage })),
);
const VehicleReviewPage = lazy(() =>
  import("@/features/vehicle/pages/review-page").then((m) => ({ default: m.ReviewPage })),
);
const VehicleKycPage = lazy(() =>
  import("@/features/vehicle/pages/kyc-page").then((m) => ({ default: m.KycPage })),
);
const VehiclePaymentPage = lazy(() =>
  import("@/features/vehicle/pages/payment-page").then((m) => ({ default: m.PaymentPage })),
);

/** Shorthand for a legacy route whose flow is rebuilt in a later phase. */
function placeholder(path: string, title: string, vertical?: string): RouteObject {
  return { path, element: <PlaceholderPage title={title} vertical={vertical} /> };
}

const PET_SERVICES = "Pet Services";
const VEHICLE = "Vehicle Insurance";
const HEALTH = "Health Insurance";
const PET = "Pet Insurance";
const POST_SALE = "Policy Services";
const CHECKOUT = "Checkout";
const ACCOUNT = "My Account";

/**
 * Full route table. Every path from the legacy app (AllRoutes.jsx) is
 * preserved verbatim — including legacy casing — so existing links,
 * bookmarks and gateway redirects keep working.
 */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      // ---------- Auth ----------
      {
        element: <AuthLayout />,
        children: [
          {
            element: <PublicRoute />,
            children: [
              {
                path: ROUTES.auth.login,
                element: <LoginPage />,
                // Legacy renewal deep-links that land on the login screen.
                children: [
                  { path: "life-renewal" },
                  { path: "health-renewal" },
                  { path: "motor-renewal" },
                  { path: "two-wheeler-renewal" },
                ],
              },
              { path: ROUTES.auth.signup, element: <SignupPage /> },
              { path: ROUTES.auth.newLogin, element: <NewLoginPage /> },
            ],
          },
        ],
      },

      // ---------- Insurance journeys (slim wizard chrome) ----------
      {
        element: <WizardLayout />,
        children: [
          // Two-wheeler journey
          { path: ROUTES.vehicle.start, element: <VehicleNumberPage category="twoWheeler" /> },
          { path: ROUTES.vehicle.confirmDetails, element: <VehicleDetailsPage /> },
          { path: ROUTES.vehicle.coverage, element: <VehicleReviewPage /> },
          placeholder(ROUTES.vehicle.coverageHizuno, "Choose Your Coverage — Zuno", VEHICLE),
          placeholder(ROUTES.vehicle.coverageHdfc, "Choose Your Coverage — HDFC", VEHICLE),
          { path: ROUTES.vehicle.quotes, element: <VehicleComparePage /> },
          placeholder(ROUTES.vehicle.hizunoCheckout, "Zuno Checkout", VEHICLE),
          placeholder(ROUTES.vehicle.editNumber, "Edit Vehicle Number", VEHICLE),
          placeholder(ROUTES.vehicle.editCity, "Edit Registration City", VEHICLE),
          placeholder(ROUTES.vehicle.editYear, "Edit Registration Year", VEHICLE),
          placeholder(ROUTES.vehicle.selectVehicle, "Select Your Vehicle", VEHICLE),
          placeholder(ROUTES.vehicle.selectModel, "Select Vehicle Model", VEHICLE),
          placeholder(ROUTES.vehicle.selectVariant, "Select Vehicle Variant", VEHICLE),
          // Car journey
          { path: ROUTES.vehicle.carStart, element: <VehicleNumberPage category="fourWheeler" /> },
          { path: ROUTES.vehicle.apiForm, element: <VehicleProposalPage /> },
          placeholder(ROUTES.vehicle.bikePay, "Bike Payment", VEHICLE),
          { path: ROUTES.vehicle.kycStatus, element: <VehicleKycPage /> },
          { path: ROUTES.vehicle.paymentPage, element: <VehiclePaymentPage /> },
          // Insurer-specific steps
          placeholder(ROUTES.vehicle.bajajKyc, "Bajaj KYC", VEHICLE),
          placeholder(ROUTES.vehicle.bajajCreateQuote, "Bajaj Proposal", VEHICLE),
          placeholder(ROUTES.vehicle.goDigitForm, "GoDigit Proposal", VEHICLE),
          placeholder(ROUTES.vehicle.hdfcKyc, "HDFC KYC", VEHICLE),
          placeholder(ROUTES.vehicle.hdfcApiForm, "HDFC Proposal", VEHICLE),
          placeholder(ROUTES.vehicle.zunoCreateQuote, "Zuno Proposal", VEHICLE),
          placeholder(ROUTES.vehicle.zunoKyc, "Zuno KYC", VEHICLE),
          placeholder(ROUTES.vehicle.zunoNwCheckout, "Zuno Checkout", VEHICLE),
          // New vehicle journey
          placeholder(ROUTES.vehicle.newCar, "New Car Insurance", VEHICLE),
          placeholder(ROUTES.vehicle.newBike, "New Bike Insurance", VEHICLE),
          placeholder(ROUTES.vehicle.newViewDetails, "Review Vehicle Details", VEHICLE),
          placeholder(ROUTES.vehicle.newQuotes, "Compare New Vehicle Quotes", VEHICLE),
          placeholder(ROUTES.vehicle.newCreateQuote, "New Vehicle Proposal", VEHICLE),
          placeholder(ROUTES.vehicle.newKyc, "New Vehicle KYC", VEHICLE),
          // New commercial journey
          placeholder(ROUTES.vehicle.newCommercial, "Commercial Vehicle Insurance", VEHICLE),
          placeholder(ROUTES.vehicle.newCommercialDetails, "Commercial Vehicle Details", VEHICLE),
          placeholder(ROUTES.vehicle.newCommercialQuotes, "Compare Commercial Quotes", VEHICLE),
          placeholder(ROUTES.vehicle.newCommercialCreateQuote, "Commercial Proposal", VEHICLE),
          placeholder(ROUTES.vehicle.newCommercialKyc, "Commercial KYC", VEHICLE),

          // Health journey
          placeholder(ROUTES.health.start, "Health Insurance", HEALTH),
          placeholder(ROUTES.health.city, "Select Your City", HEALTH),
          placeholder(ROUTES.health.info, "Coverage Information", HEALTH),
          placeholder(ROUTES.health.multiPolicy, "Family Members", HEALTH),
          placeholder(ROUTES.health.medical, "Medical History", HEALTH),
          placeholder(ROUTES.health.wrapper, "Health Plans", HEALTH),
          placeholder(ROUTES.health.multiInc, "Family Coverage", HEALTH),
          placeholder(ROUTES.health.age, "Member Ages", HEALTH),
          placeholder(ROUTES.health.groupHealth, "Group Health Insurance", HEALTH),
          placeholder(ROUTES.health.groupHealthAge, "Group Member Ages", HEALTH),
          placeholder(ROUTES.health.multi, "Multi-Member Plans", HEALTH),
          placeholder(ROUTES.health.filter, "Filter Plans", HEALTH),
          placeholder(ROUTES.health.plan, "Health Plan Details", HEALTH),
          placeholder(ROUTES.health.formFirst, "Proposal — Step 1", HEALTH),
          placeholder(ROUTES.health.formSecond, "Proposal — Step 2", HEALTH),
          placeholder(ROUTES.health.formThird, "Proposal — Step 3", HEALTH),
          placeholder(ROUTES.health.formFour, "Proposal — Step 4", HEALTH),
          placeholder(ROUTES.health.medicalFirst, "Medical Questions — Part 1", HEALTH),
          placeholder(ROUTES.health.medicalSecond, "Medical Questions — Part 2", HEALTH),
          placeholder(ROUTES.health.nominee, "Nominee Details", HEALTH),
          placeholder(ROUTES.health.checkout, "Health Checkout", HEALTH),

          // Pet insurance journey
          placeholder(ROUTES.pet.start, "Pet Insurance", PET),
          placeholder(ROUTES.pet.idv, "Pet Cover Value", PET),
          placeholder(ROUTES.pet.home, "Pet Insurance", PET),
          placeholder(ROUTES.pet.stepOne, "Pet Details — Step 1", PET),
          placeholder(ROUTES.pet.info, "Pet Information", PET),
          placeholder(ROUTES.pet.stepTwo, "Pet Details — Step 2", PET),
          placeholder(ROUTES.pet.stepThree, "Pet Details — Step 3", PET),
          placeholder(ROUTES.pet.stepFour, "Pet Details — Step 4", PET),
          placeholder(ROUTES.pet.stepFive, "Pet Details — Step 5", PET),
          placeholder(ROUTES.pet.buy, "Buy Pet Insurance", PET),
          placeholder(ROUTES.pet.priceCompare, "Compare Pet Insurance Plans", PET),
        ],
      },

      // ---------- Main site ----------
      {
        element: <MainLayout />,
        children: [
          { path: ROUTES.home, element: <HomePage /> },
          { path: ROUTES.homepage, element: <HomePage /> },
          { path: ROUTES.ecommerceHome, element: <HomePage /> },
          placeholder(ROUTES.lifeInsurance, "Life Insurance"),
          placeholder(ROUTES.termsAndConditions, "Terms & Conditions"),

          // Pet services e-commerce (phase 5)
          placeholder(ROUTES.petServices.shop, "Pet Services", PET_SERVICES),
          placeholder(ROUTES.petServices.buy, "Buy Services", PET_SERVICES),
          placeholder(ROUTES.petServices.cart, "Your Cart", PET_SERVICES),
          placeholder(ROUTES.petServices.createPackage, "Build a Custom Package", PET_SERVICES),
          placeholder(ROUTES.petServices.notifications, "Notifications", PET_SERVICES),
          placeholder(ROUTES.petServices.petTracking, "Pet Tracking", PET_SERVICES),
          placeholder(ROUTES.petServices.qrScanner, "QR Scanner", PET_SERVICES),

          // Payment results (gateway redirect targets — must stay at these paths)
          placeholder(ROUTES.checkout.paymentSuccess, "Payment Successful", CHECKOUT),
          placeholder(ROUTES.checkout.paymentSummary, "Payment Summary", CHECKOUT),
          placeholder(ROUTES.checkout.paymentDone, "Payment Complete", CHECKOUT),
          placeholder(ROUTES.checkout.insurancePaymentSuccess, "Payment Successful", CHECKOUT),
          placeholder(ROUTES.checkout.hdfcSuccess, "Payment Successful", CHECKOUT),
          placeholder(ROUTES.checkout.hdfcFailure, "Payment Failed", CHECKOUT),
          placeholder(ROUTES.checkout.bajajPaymentSuccess, "Payment Successful", CHECKOUT),
          placeholder(ROUTES.checkout.formPage, "Submit Details", CHECKOUT),
          placeholder(ROUTES.pet.paymentSuccess, "Payment Successful", PET),
          placeholder(ROUTES.pet.bajajPaymentSuccess, "Payment Successful", PET),

          // Claims static pages
          placeholder(ROUTES.postSale.claimNew, "Start a New Claim", POST_SALE),
          placeholder(ROUTES.postSale.claimAlreadyFiled, "Already Filed a Claim", POST_SALE),
          placeholder(ROUTES.postSale.claimFiling, "Filing a Claim", POST_SALE),
          placeholder(ROUTES.postSale.claimTrack, "Track an Existing Claim", POST_SALE),

          // Misc legacy utility routes
          placeholder(ROUTES.misc.loader, "Loading", undefined),
          placeholder(ROUTES.vehicle.bikeLoader, "Loading", undefined),
          placeholder(ROUTES.account.dashboardLogin, "Dashboard Login", ACCOUNT),
          placeholder(ROUTES.account.dashboardHome, "Dashboard", ACCOUNT),
          placeholder(ROUTES.account.afterLogDash, "Dashboard", ACCOUNT),

          // Protected (same guard set as the legacy app)
          {
            element: <ProtectedRoute />,
            children: [
              placeholder(ROUTES.petServices.booking, "Confirm Your Booking", PET_SERVICES),
              placeholder(ROUTES.petServices.serviceHistory, "Service History", PET_SERVICES),
              placeholder(ROUTES.postSale.endorsements, "Endorsements", POST_SALE),
              placeholder(ROUTES.postSale.claimsIntimation, "Claims Intimation", POST_SALE),
              placeholder(ROUTES.postSale.renewals, "Renewals", POST_SALE),
              placeholder(ROUTES.postSale.grievance, "Raise a Grievance", POST_SALE),
              placeholder(ROUTES.checkout.main, "Checkout", CHECKOUT),
              placeholder(ROUTES.checkout.otp, "Verify OTP", CHECKOUT),
            ],
          },

          { path: "*", element: <NotFoundPage /> },
        ],
      },

      // ---------- Account area ----------
      {
        element: <DashboardLayout />,
        children: [
          placeholder(ROUTES.account.myPolicy, "My Policies", ACCOUNT),
          placeholder(ROUTES.account.wallet, "Wallet", ACCOUNT),
          placeholder(ROUTES.account.support, "Support", ACCOUNT),
          placeholder(ROUTES.account.supportHelp, "Help Center", ACCOUNT),
          placeholder(ROUTES.account.supportTerms, "Terms & Conditions", ACCOUNT),
          {
            element: <ProtectedRoute />,
            children: [
              placeholder(ROUTES.account.profile, "Profile", ACCOUNT),
              placeholder(ROUTES.account.editProfile, "Edit Profile", ACCOUNT),
              placeholder(ROUTES.account.editProfileData, "Edit Profile Details", ACCOUNT),
            ],
          },
        ],
      },
    ],
  },
];
