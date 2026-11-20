import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { setPendingNav } from '@/constants/pendingNav';
import { colors, shared, spacing } from '@/constants/theme';
import { parkingSize, type TruckStop } from '@/data/types';
import { AmenityChips } from './AmenityChips';

interface StopCardProps {
  stop: TruckStop;
  // Optional context line under the route line — e.g. "12.4 mi ahead on
  // your route" (Fuel tab). The Truck Stops tab passes nothing.
  distanceLabel?: string;
  // Optional small pill next to the name — e.g. "CHEAPEST" (Fuel tab).
  badge?: string;
  // Optional formatted diesel price, e.g. "$3.89/gal". Only ever passed
  // when the stop's data actually carries a price — never estimated.
  priceLabel?: string;
}

export function StopCard({ stop, distanceLabel, badge, priceLabel }: StopCardProps) {
  const pinColor = colors.chain[stop.chain] ?? colors.primary;
  // Parking size (build #19): only when the stop's data carries a
  // real spot count — never estimated.
  const size = parkingSize(stop.spots);

  // Hand the destination to the Map tab, which drops the pin and offers
  // the in-app truck route — no more kicking the driver out to a browser.
  const openDirections = () => {
    setPendingNav({
      name: stop.name,
      latitude: stop.latitude,
      longitude: stop.longitude,
      query: `${stop.name}, ${stop.city}, ${stop.state}`,
    });
    router.navigate('/(tabs)/map');
  };

  return (
    <View style={[shared.card, styles.card]}>
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: pinColor }]} />
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{stop.name}</Text>
            {badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
            {size ? (
              <View
                style={styles.sizeBadge}
                accessibilityLabel={`Parking size ${size.letter}: ${size.label}`}>
                <Text style={styles.sizeBadgeText}>
                  {size.letter} · {stop.spots} spots
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.route}>
            {[
              stop.chain,
              [stop.interstate, stop.exit].filter(Boolean).join(' '),
              stop.city ? `${stop.city}, ${stop.state}` : stop.state,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {distanceLabel ? (
            <Text style={styles.distance}>{distanceLabel}</Text>
          ) : null}
        </View>
        {priceLabel ? (
          <View style={styles.priceBlock}>
            <Text style={styles.price}>{priceLabel}</Text>
            <Text style={styles.priceUnit}>diesel</Text>
          </View>
        ) : null}
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
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  name: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: colors.success,
    borderRadius: 999,
    marginLeft: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#0B1512',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sizeBadge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    marginLeft: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sizeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  distance: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  priceBlock: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  price: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  priceUnit: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '600',
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
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.75,
  },
});
