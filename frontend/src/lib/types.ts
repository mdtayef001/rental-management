// The shape of everything the API returns.
//
// Django sends camelCase (see JSON_UNDERSCOREIZE in backend/config/settings.py) and every
// id as a string, so these types mirror the serializers one for one. When a serializer
// changes, change it here too — that mismatch is the one thing TypeScript can't catch.

export type Role = "superadmin" | "owner" | "manager" | "staff"
export type TenantRole = Exclude<Role, "superadmin">

export type ModuleId = "rentals"

export type PermissionId =
  | "managerUsers"
  | "managerProducts"
  | "managerCustomers"
  | "managerBranches"
  | "managerActivity"
  | "managerProfit"
  | "staffCreateProducts"

/** Per-person rights, which only limit staff: owners and managers always have them. */
export type RightId = "canRent" | "canTakeReturns" | "canAddStock"

export type RentalPlan = "daily" | "weekly" | "monthly" | "fixed"
export type RentalStatus = "active" | "partly_returned" | "returned" | "cancelled"
export type ReturnCondition = "good" | "damaged" | "lost"
export type PaymentMethod = "cash" | "mobile" | "card" | "bank"
export type StockReason =
  | "purchase"
  | "rent_out"
  | "rent_return"
  | "supplier_return"
  | "adjustment"
  | "damage"
  | "lost"

/** One page of a list. The API only paginates when the caller asks with `?page=`. */
export interface Page<T> {
  count: number
  page: number
  results: T[]
}

export interface BusinessSettings {
  currency: string
  modules: Record<ModuleId, boolean>
  permissions: Record<PermissionId, boolean>
  rentals: {
    defaultPlan: RentalPlan
    lateFeeMultiplier: number
    allowOpenEnded: boolean
  }
  receiptNote: string
  lowStockAlert: number
}

export interface Branch {
  id: string
  name: string
  address: string
  phone: string
}

export interface Business {
  id: string
  name: string
  industry: string
  phone: string
  address: string
  status: "active" | "suspended"
  suspended: boolean
  suspendedReason: string
  settings: BusinessSettings
  /** Changes whenever the logo does. Empty when the business has no logo. */
  logoVersion: string
  branches: Branch[]
  createdAt: string
}

export interface SessionUser {
  id: string
  name: string
  email: string
  phone: string
  role: Role
  isActive: boolean
  isMainOwner: boolean
  branchIds: string[]
  dateJoined: string
  lastLogin: string | null
  canRent: boolean
  canTakeReturns: boolean
  canAddStock: boolean
  /** Which roles this user may hand out. Only present on `auth/me`. */
  creatableRoles?: TenantRole[]
}

export interface Product {
  id: string
  sku: string
  barcode: string
  name: string
  category: string
  unit: string
  description: string
  rentable: boolean
  rentDaily: number | null
  rentWeekly: number | null
  rentMonthly: number | null
  replacementCost: number
  lowStockThreshold: number
  /** Quantity on the shelf, keyed by branch id. */
  stock: Record<string, number>
  onHand: number
  outOnRent: number
  archivedAt: string | null
  createdAt: string
}

/** What a scan resolves to. Smaller than Product on purpose: this runs on every scan. */
export interface ProductLookup {
  id: string
  sku: string
  barcode: string
  name: string
  unit: string
  category: string
  rentable: boolean
  rentDaily: number | null
  rentWeekly: number | null
  rentMonthly: number | null
  replacementCost: number
  stock: Record<string, number>
  onHand: number
}

export interface StockLevel {
  id: string
  productId: string
  productName: string
  productSku: string
  branchId: string
  branchName: string
  quantity: number
  low: boolean
}

export interface StockMovement {
  id: string
  at: string
  productName: string
  branchName: string
  change: number
  balance: number
  reason: StockReason
  note: string
  byName: string
}

export interface Customer {
  id: string
  name: string
  company: string
  phone: string
  email: string
  address: string
  idType: string
  idNumber: string
  notes: string
  blocked: boolean
  blockedReason: string
  openRentalCount?: number
  rentalCount?: number
  balanceDue?: number
  /** Set once they are removed: off the list, but their rentals and bills keep their name. */
  archivedAt: string | null
  createdAt: string
}

export interface RentalItem {
  id: string
  productId: string | null
  productName: string
  productSku: string
  quantity: number
  quantityReturned: number
  quantityLost: number
  /** Still with the customer, and so still returnable. */
  quantityOut: number
  plan: RentalPlan
  rate: number
  replacementCost: number
  holidays: number
  daysOut: number | null
  lineTotal: number
  returnedAt: string | null
  note: string
}

export interface RentalReturnLine {
  id: string
  itemId: string
  productName: string
  quantity: number
  condition: ReturnCondition
  daysOut: number
  holidays: number
  rentAmount: number
  lateFee: number
  damageFee: number
  total: number
  note: string
}

export interface RentalReturn {
  id: string
  code: string
  rentalId: string
  rentalCode: string
  customerName: string
  at: string
  rentTotal: number
  lateFee: number
  damageFee: number
  discount: number
  charges: number
  paidAmount: number
  /** Unused advance handed back at this return. */
  refunded: number
  paymentMethod: PaymentMethod | ""
  paymentReference: string
  note: string
  token: string
  lines: RentalReturnLine[]
  byName: string
}

export interface RentalPayment {
  id: string
  amount: number
  /** `advance` was paid when the items went out; `refund` is money given back (negative). */
  kind: "advance" | "rent" | "refund"
  method: PaymentMethod | ""
  reference: string
  note: string
  at: string
  byName: string
}

export interface Rental {
  id: string
  code: string
  status: RentalStatus
  customerId: string | null
  customerName: string
  customerPhone: string
  branchName: string
  startedAt: string
  dueAt: string | null
  returnedAt: string | null
  rentTotal: number
  lateFee: number
  damageFee: number
  discount: number
  /** Everything paid, less anything given back. Includes money paid in advance. */
  paidAmount: number
  charges: number
  /** What is still owed. Negative while the customer has paid more than has been charged. */
  balance: number
  isOverdue: boolean
  daysLate: number
  itemCount: number
  unitsOut: number
  notes: string
  createdAt: string
  /** Only on the detail endpoint. */
  items?: RentalItem[]
  returns?: RentalReturn[]
  payments?: RentalPayment[]
  token?: string
  createdByName?: string
}

/**
 * One candidate on the return screen.
 *
 * This is the answer to "which of these is the customer bringing back?" — so it carries
 * everything needed to tell two rentals of the same product apart without another request.
 */
export interface ReturnMatch {
  itemId: string
  rentalId: string
  rentalCode: string
  customerId: string | null
  customerName: string
  customerPhone: string
  branchName: string
  productId: string | null
  productName: string
  productSku: string
  quantity: number
  quantityReturned: number
  quantityLost: number
  quantityOut: number
  plan: RentalPlan
  rate: number
  replacementCost: number
  /** Paid in advance on this rental and not yet used up. */
  rentalCredit: number
  startedAt: string
  dueAt: string | null
  daysOut: number
  overdueDays: number
  isOverdue: boolean
  /** What this line would cost if everything still out came back now. */
  quoteNow: number
}

export interface ResolveReturnResult {
  /** How the code was understood, or null when nothing matched. */
  matchedBy: "product" | "rental" | "customer" | null
  product: { id: string; name: string; sku: string } | null
  rental: {
    id: string
    code: string
    status: RentalStatus
    customerName: string
    startedAt: string
    dueAt: string | null
    balance: number
  } | null
  matches: ReturnMatch[]
  /** Set when there is exactly one candidate, so the screen can skip the chooser. */
  exact: string | null
}

export interface RentalSummary {
  open: number
  overdue: number
  dueToday: number
  /** Rentals whose last unit came back today. */
  returnedToday: number
  /** Take-backs recorded today, and the units in them: counts part returns too. */
  returnsToday: number
  unitsReturnedToday: number
  /** Still to collect, and money held that customers paid ahead. Never netted together. */
  owed: number
  advances: number
  revenueMonth: number
  unitsOut: number
}

export interface Activity {
  id: string
  at: string
  action: string
  detail: string
  userName: string
}

/** The super admin's view of a tenant. Counts only — never their data. */
export interface PlatformBusiness {
  id: string
  name: string
  industry: string
  phone: string
  address: string
  status: "active" | "suspended"
  suspended: boolean
  suspendedReason: string
  ownerName: string
  ownerEmail: string
  userCount: number
  createdAt: string
}

// ---------- Reports ----------
//
// Every figure below is one database aggregate. The split between the two halves of
// `ReportSummary` is the thing to understand: the dated figures cover the chosen range,
// and the standing ones are simply true right now, whatever range is selected.

/** How a revenue series is bucketed. Chosen automatically from the length of the range. */
export type ReportGroup = "day" | "week" | "month"

/** The reports that can be downloaded as CSV. */
export type ReportExport = "revenue" | "products" | "customers" | "rentals" | "returns" | "payments" | "debtors"

export interface ReportRange {
  /** Both ends inclusive, as `YYYY-MM-DD` local dates. */
  from: string
  to: string
}

export interface ReportSummary extends ReportRange {
  days: number

  // Earned in the range, from the returns that charged it.
  revenue: number
  rent: number
  lateFees: number
  damageFees: number
  discounts: number
  returns: number

  // Happened in the range.
  rentals: number
  cancelled: number
  lines: number
  unitsRented: number
  unitsReturned: number
  unitsLost: number
  unitsDamaged: number
  newCustomers: number

  // Through the till in the range, which is not the same as earned.
  collected: number
  refunded: number

  // True right now, whatever the range.
  openRentals: number
  overdue: number
  unitsOut: number
  outstanding: number
  /** Paid in advance by customers and not yet charged. */
  advancesHeld: number
}

export interface RevenueRow {
  /** The first day of the bucket, as `YYYY-MM-DD`. */
  period: string
  returns: number
  rent: number
  lateFees: number
  damageFees: number
  discounts: number
  revenue: number
  /** What the bucket is made of: one entry for each product a customer brought back. */
  details: {
    customer: string
    rentalCode: string
    product: string
    sku: string
    barcode: string
    units: number
    amount: number
  }[]
}

export interface ProductReportRow {
  /** Null once the product has been deleted; its history still counts. */
  id: string | null
  name: string
  sku: string
  rentals: number
  units: number
  lost: number
  damaged: number
  rent: number
  lateFees: number
  damageFees: number
  revenue: number
}

export interface CustomerReportRow {
  id: string | null
  name: string
  phone: string
  rentals: number
  returns: number
  rent: number
  lateFees: number
  damageFees: number
  discounts: number
  revenue: number
  /** Unpaid across every rental they have ever had, not just this range. */
  outstanding: number
}

/** A customer who owes money today, whatever the report's dates. */
export interface DebtorRow {
  id: string | null
  name: string
  phone: string
  openRentals: number
  oldestOpen: string | null
  owed: number
}

/** A price agreed with one customer for one product, beside the product's own. */
export interface CustomerRate {
  id: string
  productId: string
  productName: string
  productSku: string
  plan: RentalPlan
  rate: number
  /** What everyone else pays, or null when the product has no rate for this plan. */
  defaultRate: number | null
  updatedAt: string
}

// ---------- Bills ----------

/** What a bill is called: a whole calendar month, a whole year, or any other stretch. */
export type BillKind = "month" | "year" | "custom"

/** Units of one rental line coming back during the bill's period. */
export interface BillReturn {
  at: string
  quantity: number
  condition: "good" | "damaged" | "lost"
}

/**
 * Units of one rental line that share their dates: a row of the printed bill.
 * "50 machines, out 3 Nov, back 20 Nov, 17 days, 2 off."
 */
export interface BillStretch {
  quantity: number
  outAt: string
  /** Null while the units were still out when the period closed. */
  backAt: string | null
  condition: "" | "good" | "damaged" | "lost"
  /** Days out that fall inside the bill's period. */
  days: number
  /** How many of those days were not charged. */
  daysOff: number
  rent: number
  lateFee: number
  damageFee: number
  total: number
}

/** One product on one rental, as it stood across the bill's period. */
export interface BillLine {
  productName: string
  productSku: string
  plan: RentalPlan
  rate: number
  /** How many went out when the rental started. */
  quantity: number
  outAtStart: number
  /** Non-zero only when the rental started inside the period. */
  taken: number
  returned: number
  returns: BillReturn[]
  stretches: BillStretch[]
  outAtEnd: number
  billedFrom: string | null
  billedTo: string | null
  rent: number
  lateFee: number
  damageFee: number
  total: number
}

export interface BillRental {
  id: string
  code: string
  status: string
  /** The day the customer took the items. */
  startedAt: string
  dueAt: string | null
  returnedAt: string | null
  lines: BillLine[]
  rent: number
  lateFee: number
  damageFee: number
  discount: number
  total: number
  unitsOut: number
}

export interface BillPayment {
  id: string
  at: string
  rentalCode: string
  method: string
  reference: string
  note: string
  amount: number
}

/** One customer's bill for one period. */
export interface Bill extends ReportRange {
  number: string
  kind: BillKind
  label: string
  /** Set while the period is still running: the bill only goes up to this moment. */
  asOf: string | null
  issuedAt: string
  business: { name: string; phone: string; address: string; currency: string; note: string; logoVersion: string }
  customer: { id: string; name: string; company: string; phone: string; email: string; address: string }
  rentals: BillRental[]
  payments: BillPayment[]
  totals: {
    rent: number
    lateFee: number
    damageFee: number
    discount: number
    charges: number
    paid: number
    openingBalance: number
    closingBalance: number
    unitsOut: number
    unitsTaken: number
    unitsReturned: number
    daysOff: number
  }
}

/** A customer's line on the month-end list of bills. */
export interface BillRow {
  customerId: string
  customerName: string
  company: string
  phone: string
  rentals: number
  unitsOut: number
  charges: number
  paid: number
}

export interface BillList extends ReportRange {
  kind: BillKind
  label: string
  totals: { customers: number; charges: number; paid: number; unitsOut: number }
  count: number
  page: number
  results: BillRow[]
}
