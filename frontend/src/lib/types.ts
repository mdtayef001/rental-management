// The shape of everything the API returns.
//
// Django sends camelCase (see JSON_UNDERSCOREIZE in backend/config/settings.py) and every
// id as a string, so these types mirror the serializers one for one. When a serializer
// changes, change it here too — that mismatch is the one thing TypeScript can't catch.

export type Role = "superadmin" | "owner" | "manager" | "staff"
export type TenantRole = Exclude<Role, "superadmin">

export type ModuleId = "rentals" | "sales" | "purchases"

export type PermissionId =
  | "managerUsers"
  | "managerProducts"
  | "managerCustomers"
  | "managerBranches"
  | "managerActivity"
  | "managerPurchases"
  | "managerProfit"
  | "staffWalkInRentals"
  | "staffCreateProducts"

/** Per-person rights, which only limit staff: owners and managers always have them. */
export type RightId = "canRent" | "canTakeReturns" | "canSell" | "canAddStock" | "canHandleDeposits"

export type RentalPlan = "daily" | "weekly" | "monthly" | "fixed"
export type RentalStatus = "active" | "partly_returned" | "returned" | "cancelled"
export type ReturnCondition = "good" | "damaged" | "lost"
export type PaymentMethod = "cash" | "mobile" | "card" | "bank"
export type StockReason =
  | "purchase"
  | "rent_out"
  | "rent_return"
  | "sale"
  | "sale_return"
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
    depositRequired: boolean
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
  canSell: boolean
  canAddStock: boolean
  canHandleDeposits: boolean
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
  deposit: number
  replacementCost: number
  sellable: boolean
  price: number
  cost: number
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
  sellable: boolean
  rentDaily: number | null
  rentWeekly: number | null
  rentMonthly: number | null
  deposit: number
  replacementCost: number
  price: number
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
  deposit: number
  depositTotal: number
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
  depositRefunded: number
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
  kind: "deposit" | "deposit_refund" | "rent" | "refund"
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
  deposit: number
  depositRefunded: number
  rentTotal: number
  lateFee: number
  damageFee: number
  discount: number
  paidAmount: number
  charges: number
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
  deposit: number
  replacementCost: number
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
    deposit: number
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
  returnedToday: number
  depositsHeld: number
  owed: number
  revenueMonth: number
  unitsOut: number
}

export interface Supplier {
  id: string
  name: string
  company: string
  phone: string
  email: string
  address: string
  notes: string
  purchaseCount?: number
  totalBought?: number
  balance?: number
  createdAt: string
}

export interface PurchaseItem {
  id: string
  productId: string | null
  productName: string
  quantity: number
  unitCost: number
  amount: number
  quantityReturned: number
  quantityReturnable: number
}

export interface Purchase {
  id: string
  code: string
  supplierId: string | null
  supplierName: string
  branchName: string
  reference: string
  note: string
  purchasedAt: string
  total: number
  paidAmount: number
  due: number
  paymentStatus: "paid" | "partly_paid" | "unpaid"
  dueDate: string | null
  isOverdue: boolean
  items: PurchaseItem[]
  createdByName: string
  createdAt: string
}

export interface SupplierReturn {
  id: string
  code: string
  purchaseCode: string
  supplierName: string
  productName: string
  quantity: number
  unitCost: number
  reason: string
  status: "open" | "settled" | "closed"
  replacedQuantity: number
  refundedAmount: number
  creditedAmount: number
  value: number
  outstanding: number
  unitsToReplace: number
  closedNote: string
  createdAt: string
  finishedAt: string | null
}

export interface SupplierPayment {
  id: string
  code: string
  supplierName: string
  amount: number
  method: "cash" | "mobile" | "bank" | "credit" | ""
  paidAt: string
  note: string
  allocations: { purchaseCode: string; amount: number }[]
  createdByName: string
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
export type ReportExport = "revenue" | "products" | "customers" | "rentals" | "returns" | "payments"

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
  depositsTaken: number
  newCustomers: number
  purchaseBills: number
  purchaseSpend: number

  // Through the till in the range, which is not the same as earned.
  collected: number
  refunded: number

  // True right now, whatever the range.
  openRentals: number
  overdue: number
  unitsOut: number
  depositsHeld: number
  outstanding: number
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
