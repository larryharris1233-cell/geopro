import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '@/constants/theme';
import type { TruckStop } from '@/data/types';
import { AmenityChips } from './AmenityChips';

export function StopCard({ stop }: { stop: TruckStop }) {
  const pinColor = colors.chain[stop.chain] ?? colors.primary;

  const openDirections = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}`;
    void Linking.openURL(url);
  };

  return (
    <View style={[shared.card, styles.card]}>
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: pinColor }]} />
        <View style={styles.headerText}>
          <Text style={styles.name}>{stop.name}</Text>
          <Text style={styles.route}>
            {stop.chain} · {stop.interstate} {stop.exit} · {stop.city}, {stop.state}
          </Text>
        </View>
      </View>
      <AmenityChips amenities={stop.amenities} />
      <View style={styles.footer}>
        <Text style={styles.phone}>{stop.phone}</Text>
        <Pressable
          onPress={openDirections}
          accessibilityRole="button"
          accessibilityLabel={`Get directions to ${stop.name}`}
          style={({ pressed }) => [styles.directions, pressed && styles.pressed]}>
          <Text style={styles.directionsText}>Directions →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dot: {
    borderRadius: 999,
    height: 14,
    marginRight: spacing.sm,
    marginTop: 4,
    width: 14,
  },
  headerText: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  route: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  phone: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  directions: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  directionsText: {
    color: '#14100A',
    fontSize: 15,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.75,
  },
});
