import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { StopCard } from '@/components/StopCard';
import { distMi } from '@/constants/activeRoute';
import { colors, shared, spacing } from '@/constants/theme';
import truckStopsJson from '@/data/truckStops.json';
import type { TruckStop } from '@/data/types';

const truckStops = truckStopsJson as TruckStop[];

interface StopRow {
  stop: TruckStop;
  distanceLabel?: string;
}

function formatMi(mi: number): string {
  if (mi < 0.1) return 'Right here';
  if (mi < 10) return `${mi.toFixed(1)} mi away`;
  return `${Math.round(mi)} mi away`;
}

export default function StopsScreen() {
  const [query, setQuery] = useState('');
  const [myPos, setMyPos] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locDenied, setLocDenied] = useState(false);

  // Tabs stay mounted, so grab a fresh position every time the Stops
  // tab gains focus — Larry asked for nearest-first (current location)
  // instead of alphabetical when he taps into this tab.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const { status } =
            await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            if (!cancelled) setLocDenied(true);
            return;
          }
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            setMyPos({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
            setLocDenied(false);
          }
        } catch {
          // Location only sharpens the ordering; the list works without it.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const rows = useMemo<StopRow[]>(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? truckStops
      : truckStops.filter((s) =>
          [s.name, s.city, s.state, s.chain, s.interstate, s.exit].some((v) =>
            v.toLowerCase().includes(q),
          ),
        );
    if (!myPos) return base.map((stop) => ({ stop }));
    // Decorate with distance and sort nearest-first (7,722 haversines
    // is a few ms — no need to over-engineer).
    return base
      .map((stop) => {
        const mi = distMi(
          myPos.latitude,
          myPos.longitude,
          stop.latitude,
          stop.longitude,
        );
        return { stop, mi };
      })
      .sort((a, b) => a.mi - b.mi)
      .map(({ stop, mi }) => ({ stop, distanceLabel: formatMi(mi) }));
  }, [query, myPos]);

  return (
    <View style={shared.screen}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.stop.id}
        renderItem={({ item }) => (
          <StopCard stop={item.stop} distanceLabel={item.distanceLabel} />
        )}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, city, interstate, chain…"
              placeholderTextColor={colors.muted}
              style={shared.searchInput}
              returnKeyType="search"
              accessibilityLabel="Search truck stops"
            />
            <Text style={styles.count}>
              {rows.length} of {truckStops.length} stops
              {myPos
                ? ' · nearest first'
                : locDenied
                  ? ' · location off, A–Z'
                  : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No stops found</Text>
            <Text style={styles.emptyText}>
              Try a different city, interstate, or chain name.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.md,
  },
  count: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
});
