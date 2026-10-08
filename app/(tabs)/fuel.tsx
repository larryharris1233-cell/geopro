import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '@/constants/theme';

// Static v1 snapshot. The EIA publishes the Weekly Retail On-Highway Diesel
// Price every Monday (~5pm ET). v2 will pull this live with a free EIA API key.
const SNAPSHOT = {
  national: 6.199,
  week: 'October 5, 2026',
  source: 'EIA Weekly Retail On-Highway Diesel Price',
};

const REGIONS: { name: string; price: number }[] = [
  { name: 'California', price: 8.25 },
  { name: 'West Coast (PADD 5)', price: 7.42 },
  { name: 'Rocky Mountain (PADD 4)', price: 6.31 },
  { name: 'East Coast (PADD 1)', price: 6.24 },
  { name: 'Midwest (PADD 2)', price: 6.14 },
  { name: 'Gulf Coast (PADD 3)', price: 6.05 },
];

const MAX_PRICE = Math.max(...REGIONS.map((r) => r.price));

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function FuelScreen() {
  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <Text style={shared.title}>Diesel Prices</Text>
      <Text style={shared.subtitle}>
        {SNAPSHOT.source} · week of {SNAPSHOT.week}
      </Text>

      <View style={[shared.card, styles.hero]}>
        <Text style={styles.heroLabel}>US NATIONAL AVERAGE</Text>
        <Text style={styles.heroPrice}>{money(SNAPSHOT.national)}</Text>
        <Text style={styles.heroUnit}>per gallon</Text>
      </View>

      <Text style={styles.sectionTitle}>Regional averages</Text>
      <View style={shared.card}>
        {REGIONS.map((r) => (
          <View key={r.name} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.regionName}>{r.name}</Text>
              <Text style={styles.regionPrice}>{money(r.price)}</Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${(r.price / MAX_PRICE) * 100}%`,
                    backgroundColor:
                      r.price >= 7 ? colors.danger : r.price >= 6.2 ? colors.primary : colors.success,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      <View style={[shared.card, styles.note]}>
        <Text style={styles.noteTitle}>⛽ About these prices</Text>
        <Text style={styles.noteText}>
          This is a static snapshot for v1 — the benchmark number most fuel
          surcharges are based on. Live per-station pump prices, updated weekly
          from the EIA, arrive in v2.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.lg,
  },
  heroLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  heroPrice: {
    color: colors.primary,
    fontSize: 52,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  heroUnit: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  row: {
    marginBottom: spacing.md,
  },
  rowText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  regionName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  regionPrice: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  barTrack: {
    backgroundColor: colors.surface2,
    borderRadius: 6,
    height: 12,
    overflow: 'hidden',
  },
  barFill: {
    borderRadius: 6,
    height: 12,
  },
  note: {
    marginTop: spacing.lg,
  },
  noteTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  noteText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
});
