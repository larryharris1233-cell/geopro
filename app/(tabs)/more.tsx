import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '@/constants/theme';

const ROADMAP = [
  {
    title: 'User accounts + crowdsourced reports',
    detail: 'Sign in, then report weigh station status, parking availability, and shower wait times for other drivers in real time.',
  },
  {
    title: 'Live fuel prices (EIA API)',
    detail: 'Pull the weekly EIA diesel series with a free api.eia.gov key, plus per-station pump prices where available.',
  },
  {
    title: 'Real-time parking availability',
    detail: 'Crowdsourced + partner lot-sensor data so you know before you exit whether there is a spot.',
  },
  {
    title: 'ELD / Hours of Service',
    detail: 'Duty-status logging, 11/14/70-hour clocks, and break reminders built for the cab.',
  },
  {
    title: 'GeoPro subscription',
    detail: 'Free core app; paid tier unlocks offline maps, weigh-station alerts, and ad-free fuel tracking.',
  },
];

export default function MoreScreen() {
  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <View style={[shared.card, styles.about]}>
        <Text style={styles.appName}>GeoPro</Text>
        <Text style={styles.version}>v1.0.0 · built for drivers</Text>
        <Text style={styles.blurb}>
          The state-of-the-art trucker companion for US highways: truck stops,
          diesel prices, and weigh stations — dark, glove-friendly, and fast.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>v2 roadmap</Text>
      {ROADMAP.map((item, i) => (
        <View key={item.title} style={[shared.card, styles.roadmapCard]}>
          <View style={styles.roadmapHeader}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{i + 1}</Text>
            </View>
            <Text style={styles.roadmapTitle}>{item.title}</Text>
          </View>
          <Text style={styles.roadmapDetail}>{item.detail}</Text>
        </View>
      ))}

      <View style={[shared.card, styles.disclaimer]}>
        <Text style={styles.disclaimerTitle}>Fine print</Text>
        <Text style={styles.disclaimerText}>
          Seed locations, prices, and station statuses are approximate sample
          data for v1 — always confirm with signage and official sources before
          you roll. Never use the app while driving.
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
  about: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  appName: {
    color: colors.primary,
    fontSize: 32,
    fontWeight: '800',
  },
  version: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  blurb: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  roadmapCard: {
    marginBottom: spacing.md,
  },
  roadmapHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 32,
  },
  badgeText: {
    color: '#14100A',
    fontSize: 16,
    fontWeight: '800',
  },
  roadmapTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  roadmapDetail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  disclaimer: {
    marginTop: spacing.sm,
  },
  disclaimerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  disclaimerText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
});
