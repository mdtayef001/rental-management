"""The money and quantity sums every rental query needs, written once.

A rule spelt out in five places is a bug waiting for the day four of them are changed.
Views, reports, statements and the customer list all import these instead.
"""

from decimal import Decimal

from django.db.models import DecimalField, F

ZERO = Decimal("0.00")

#: Money columns are 14,2 throughout, so Coalesce and Sum over them need this output field.
MONEY = DecimalField(max_digits=14, decimal_places=2)


def charged(prefix=""):
    """What a rental has charged: rent plus fees, less any discount."""
    return F(f"{prefix}rent_total") + F(f"{prefix}late_fee") + F(f"{prefix}damage_fee") - F(f"{prefix}discount")


def balance(prefix=""):
    """What a rental still has to be paid: negative while the customer is ahead.

    `prefix` reaches the rental through a relation, e.g. `balance("rentals__")`.
    """
    return charged(prefix) - F(f"{prefix}paid_amount")


def units_out(prefix=""):
    """Units of a rental item still with the customer: neither back nor written off as lost.

    `prefix` reaches the item through a relation, e.g. `units_out("items__")`.
    """
    return F(f"{prefix}quantity") - F(f"{prefix}quantity_returned") - F(f"{prefix}quantity_lost")


CHARGED = charged()
BALANCE = balance()
UNITS_OUT = units_out()
