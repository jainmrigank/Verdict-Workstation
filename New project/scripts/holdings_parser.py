#!/usr/bin/env python3
"""Parse Zerodha-style holdings XLSX files without external dependencies."""

from __future__ import annotations

import io
import re
import zipfile
from typing import Any
from xml.etree import ElementTree as ET


SPREADSHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SUFFIX_EXCHANGES = {
    "-X": "BSE",
    "-Z": "BSE",
    "-BE": "NSE",
    "-BZ": "BSE",
    "-SM": "NSE",
    "-ST": "NSE",
    "-EQ": "NSE",
}
MARKET_EXCHANGES = {"NSE", "BSE"}
ISIN_LIKE_RE = re.compile(r"IN[A-Z0-9]{10}")


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def column_name(cell_ref: str) -> str:
    return re.sub(r"[^A-Z]", "", cell_ref.upper())


def coerce_number(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_symbol(raw_symbol: str) -> tuple[str, str]:
    symbol = raw_symbol.strip().upper()
    exchange = "NSE"
    for suffix, suffix_exchange in SUFFIX_EXCHANGES.items():
        if symbol.endswith(suffix):
            symbol = symbol[: -len(suffix)]
            exchange = suffix_exchange
            break
    return exchange, symbol


def load_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for item in root.findall(f"{SPREADSHEET_NS}si"):
        parts = [node.text or "" for node in item.iter(f"{SPREADSHEET_NS}t")]
        strings.append("".join(parts))
    return strings


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str | float | None:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        parts = [node.text or "" for node in cell.iter(f"{SPREADSHEET_NS}t")]
        return "".join(parts)
    value = cell.find(f"{SPREADSHEET_NS}v")
    if value is None or value.text is None:
        return None
    raw = value.text
    if cell_type == "s":
        index = int(raw)
        return shared_strings[index] if 0 <= index < len(shared_strings) else ""
    if cell_type == "str":
        return raw
    try:
        numeric = float(raw)
        return int(numeric) if numeric.is_integer() else numeric
    except ValueError:
        return raw


def worksheet_rows(workbook: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[dict[str, Any]]:
    root = ET.fromstring(workbook.read(sheet_path))
    rows: list[dict[str, Any]] = []
    for row in root.findall(f".//{SPREADSHEET_NS}row"):
        values: dict[str, Any] = {}
        for cell in row.findall(f"{SPREADSHEET_NS}c"):
            ref = cell.attrib.get("r", "")
            if not ref:
                continue
            values[column_name(ref)] = cell_value(cell, shared_strings)
        if values:
            rows.append(values)
    return rows


def find_header_row(rows: list[dict[str, Any]]) -> tuple[int, dict[str, str]]:
    for index, row in enumerate(rows):
        header_by_column = {
            column: normalize_header(str(value))
            for column, value in row.items()
            if value is not None and str(value).strip()
        }
        headers = set(header_by_column.values())
        if "symbol" in headers and ("averageprice" in headers or "avgprice" in headers):
            if "quantityavailable" in headers or "quantity" in headers or "qty" in headers:
                return index, header_by_column
    raise ValueError("Could not find a holdings table with Symbol, Quantity, and Average Price columns.")


def by_header(row: dict[str, Any], header_by_column: dict[str, str], *header_names: str) -> Any:
    wanted = {normalize_header(name) for name in header_names}
    for column, header in header_by_column.items():
        if header in wanted:
            return row.get(column)
    return None


def numeric_by_header(row: dict[str, Any], header_by_column: dict[str, str], *header_names: str) -> float | None:
    return coerce_number(by_header(row, header_by_column, *header_names))


def parse_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    header_index, header_by_column = find_header_row(rows)
    holdings: list[dict[str, Any]] = []
    for row in rows[header_index + 1 :]:
        raw_symbol = by_header(row, header_by_column, "Symbol")
        if not raw_symbol:
            continue
        exchange, tradingsymbol = clean_symbol(str(raw_symbol))
        sector = str(by_header(row, header_by_column, "Sector") or "").strip().upper()
        isin = by_header(row, header_by_column, "ISIN") or ""
        if sector == "UNLISTED" or (not isin and ISIN_LIKE_RE.fullmatch(tradingsymbol)):
            exchange = "UNLISTED"
        quantity_available = numeric_by_header(row, header_by_column, "Quantity Available", "Quantity", "Qty") or 0
        quantity_discrepant = numeric_by_header(row, header_by_column, "Quantity Discrepant") or 0
        pledged_margin = numeric_by_header(row, header_by_column, "Quantity Pledged (Margin)") or 0
        pledged_loan = numeric_by_header(row, header_by_column, "Quantity Pledged (Loan)") or 0
        quantity = quantity_available + quantity_discrepant + pledged_margin + pledged_loan
        average_price = numeric_by_header(row, header_by_column, "Average Price", "Avg Price") or 0
        last_price = numeric_by_header(row, header_by_column, "Previous Closing Price", "Last Price", "LTP")
        pnl = numeric_by_header(row, header_by_column, "Unrealized P&L", "Unrealized PNL", "P&L")
        if pnl is None and last_price is not None:
            pnl = (quantity * last_price) - (quantity * average_price)
        if quantity <= 0:
            continue
        holdings.append(
            {
                "tradingsymbol": tradingsymbol,
                "source_symbol": str(raw_symbol).strip().upper(),
                "exchange": exchange,
                "isin": isin,
                "sector": sector,
                "quantity": quantity,
                "average_price": average_price,
                "last_price": last_price or 0,
                "pnl": pnl or 0,
            }
        )
    if not holdings:
        raise ValueError("No equity holdings were found in the uploaded workbook.")
    return holdings


def parse_holdings_xlsx(data: bytes) -> list[dict[str, Any]]:
    with zipfile.ZipFile(io.BytesIO(data)) as workbook:
        shared_strings = load_shared_strings(workbook)
        sheet_paths = sorted(
            name
            for name in workbook.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        errors: list[str] = []
        for sheet_path in sheet_paths:
            try:
                rows = worksheet_rows(workbook, sheet_path, shared_strings)
                return parse_rows(rows)
            except ValueError as exc:
                errors.append(f"{sheet_path}: {exc}")
        raise ValueError("No supported holdings sheet found. " + " | ".join(errors))


def holdings_to_symbols(holdings: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for holding in holdings:
        exchange = str(holding.get("exchange") or "NSE").upper()
        tradingsymbol = str(holding.get("tradingsymbol") or "").upper()
        if exchange not in MARKET_EXCHANGES or not tradingsymbol:
            continue
        key = f"{exchange}:{tradingsymbol}"
        if key not in seen:
            output.append(key)
            seen.add(key)
    return output
