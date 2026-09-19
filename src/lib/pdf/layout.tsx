import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Shared TaxDesk OS PDF chrome: header (company block from settings),
 * case/client meta strip, footer disclaimers + page numbers.
 * Fonts: built-in Helvetica (no font files, deterministic on
 * serverless). Note: use "Rs." not the ₹ glyph — Helvetica WinAnsi
 * does not include U+20B9.
 */

export interface PdfCompany {
  name: string;
  address: string;
  phone: string;
  email: string;
}

export interface PdfBaseData {
  company: PdfCompany;
  clientName: string;
  clientCode: string;
  caseCode: string;
  caseTitle: string;
  serviceName: string;
  generatedAt: string; // display string
  generatedBy: string;
}

export const s = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 40,
    paddingBottom: 92,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a2333",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: "#1d3f77",
    paddingBottom: 8,
    marginBottom: 10,
  },
  logoBox: {
    width: 54,
    height: 54,
    borderWidth: 1,
    borderColor: "#1d3f77",
    alignItems: "center",
    justifyContent: "center",
  },
  companyName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1d3f77" },
  small: { fontSize: 8, color: "#555f6e" },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#f0f3f8",
    padding: 6,
    marginBottom: 12,
    gap: 12,
  },
  metaItem: { fontSize: 9 },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  h1: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 8, color: "#1d3f77" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  p: { marginBottom: 5, lineHeight: 1.45 },
  table: { borderWidth: 1, borderColor: "#c6cedb", marginVertical: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#c6cedb" },
  trLast: { flexDirection: "row" },
  th: {
    fontFamily: "Helvetica-Bold",
    backgroundColor: "#e6ebf3",
    padding: 4,
    fontSize: 9,
  },
  td: { padding: 4, fontSize: 9 },
  cellGrow: { flexGrow: 1, flexBasis: 0 },
  cellNum: { width: 90, textAlign: "right" },
  cellStatus: { width: 80 },
  sigRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 36 },
  sigBox: { width: "42%", borderTopWidth: 1, borderTopColor: "#1a2333", paddingTop: 4 },
  watermark: {
    position: "absolute",
    top: 300,
    left: 120,
    fontSize: 72,
    color: "#e0e4ec",
    transform: "rotate(-30deg)",
    fontFamily: "Helvetica-Bold",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#c6cedb",
    paddingTop: 6,
  },
  disclaimer: { fontSize: 7, color: "#555f6e", marginBottom: 2, lineHeight: 1.35 },
  pageNum: { fontSize: 8, color: "#555f6e", textAlign: "right", marginTop: 2 },
});

export function PracticeDoc({
  base,
  title,
  disclaimers,
  watermark,
  children,
}: {
  base: PdfBaseData;
  title: string;
  disclaimers: string[];
  watermark?: string;
  children: React.ReactNode;
}) {
  return (
    <Document title={`${title} — ${base.caseCode}`} author={base.company.name}>
      <Page size="A4" style={s.page}>
        {watermark && (
          <Text style={s.watermark} fixed>
            {watermark}
          </Text>
        )}

        <View style={s.headerRow} fixed>
          <View>
            <Text style={s.companyName}>{base.company.name}</Text>
            <Text style={s.small}>{base.company.address}</Text>
            <Text style={s.small}>
              {base.company.phone} · {base.company.email}
            </Text>
          </View>
          <View style={s.logoBox}>
            <Text style={{ fontSize: 7, color: "#1d3f77" }}>LOGO</Text>
          </View>
        </View>

        <View style={s.metaRow}>
          <Text style={s.metaItem}>
            <Text style={s.metaLabel}>Client: </Text>
            {base.clientName} ({base.clientCode})
          </Text>
          <Text style={s.metaItem}>
            <Text style={s.metaLabel}>Case: </Text>
            {base.caseCode}
          </Text>
          <Text style={s.metaItem}>
            <Text style={s.metaLabel}>Service: </Text>
            {base.serviceName}
          </Text>
          <Text style={s.metaItem}>
            <Text style={s.metaLabel}>Date: </Text>
            {base.generatedAt}
          </Text>
        </View>

        <Text style={s.h1}>{title}</Text>

        {children}

        <View style={s.footer} fixed>
          {disclaimers.map((d, i) => (
            <Text key={i} style={s.disclaimer}>
              {d}
            </Text>
          ))}
          <Text
            style={s.pageNum}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export function SignatureBlocks({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.sigRow}>
      <View style={s.sigBox}>
        <Text>{left}</Text>
        <Text style={s.small}>Signature · Date</Text>
      </View>
      <View style={s.sigBox}>
        <Text>{right}</Text>
        <Text style={s.small}>Signature · Date</Text>
      </View>
    </View>
  );
}
