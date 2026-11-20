import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { StopCard } from '@/components/StopCard';
import {
  ALONG_ROUTE_TOLERANCE_MI,
  distMi,
  getActiveRoute,
  projectOntoRoute,
  type ActiveRoute,
  type RouteProjection,
} from '@/constants/activeRoute';
import { colors, shared, spacing } from '@/constants/theme';
import truckStopsJson from '@/data/truckStops.json';
import type { TruckStop } from '@/data/types';

const truckStops = truckStopsJson as TruckStop[];
// Fuel stops = bundled stops that sell diesel (today that is all of them).
const FUEL_STOPS = truckStops.filter((s) => s.amenities.includes('diesel'));

// Static v1 snapshot. The EIA publishes the Weekly Retail On-Highway Diesel
// Price every Monday (~5pm ET). These are regional AVERAGES — the benchmark
// most fuel surcharges are based on — never per-station pump prices.
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

type SortMode = 'route' | 'nearest' | 'cheapest';

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'route', label: 'Along my route' },
  { key: 'nearest', label: 'Nearest' },
  { key: 'cheapest', label: 'Cheapest' },
];

interface DecoratedStop {
  stop: TruckStop;
  straightMi: number | null;
  proj: RouteProjection | null;
  aheadMi: number | null;
}

function byNearest(a: DecoratedStop, b: DecoratedStop): number {
  return (a.straightMi ?? Infinity) - (b.straightMi ?? Infinity);
}

interface FuelRow {
  stop: TruckStop;
  distanceLabel?: string;
  priceLabel?: string;
  badge?: string;
}

export default function FuelScreen() {
  // Default view: along the route when one is planned, nearest otherwise —
  // until the driver picks a sort themselves.
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    getActiveRoute() ? 'route' : 'nearest',
  );
  const [route, setRoute] = useState<ActiveRoute | null>(() => getActiveRoute());
  const [myPos, setMyPos] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const [locDenied, setLocDenied] = useState(false);
  const sortTouched = useRef(false);

  // Tabs stay mounted, so refresh the route snapshot and position every
  // time the Fuel tab gains focus — a route planned after the app started
  // (or cleared since) is picked up here.
  useFocusEffect(
    useCallback(() => {
      const r = getActiveRoute();
      setRoute(r);
      if (!sortTouched.current) {
        setSortMode(r ? 'route' : 'nearest');
      }
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

  const chooseSort = (mode: SortMode) => {
    sortTouched.current = true;
    setSortMode(mode);
  };

  const { rows, note } = useMemo(() => {
    // The cheapest stop is only ever one whose data carries a real price.
    let cheapest: TruckStop | null = null;
    let pricedCount = 0;
    for (const s of FUEL_STOPS) {
      if (typeof s.dieselPrice === 'number') {
        pricedCount += 1;
        if (!cheapest || s.dieselPrice < (cheapest.dieselPrice ?? Infinity)) {
          cheapest = s;
        }
      }
    }

    const driverAlong =
      route && myPos
        ? projectOntoRoute(route, myPos.latitude, myPos.longitude).alongMi
        : null;

    const decorated: DecoratedStop[] = FUEL_STOPS.map((stop) => {
      const straightMi = myPos
        ? distMi(myPos.latitude, myPos.longitude, stop.latitude, stop.longitude)
        : null;
      const proj = route
        ? projectOntoRoute(route, stop.latitude, stop.longitude)
        : null;
      const aheadMi = proj ? proj.alongMi - (driverAlong ?? 0) : null;
      return { stop, straightMi, proj, aheadMi };
    });

    let list: DecoratedStop[];
    let note: string | null = null;

    if (sortMode === 'route') {
      if (route) {
        list = decorated
          .filter((d) => d.proj !== null && d.proj.offMi <= ALONG_ROUTE_TOLERANCE_MI)
          .sort((a, b) => {
            const ah = a.aheadMi ?? 0;
            const bh = b.aheadMi ?? 0;
            const aBehind = ah < -0.1;
            const bBehind = bh < -0.1;
            if (aBehind !== bBehind) return aBehind ? 1 : -1;
            return aBehind ? bh - ah : ah - bh;
          });
        note = `On your ${route.miles.toFixed(0)} mi route · within ${ALONG_ROUTE_TOLERANCE_MI} mi of the route line, in the order you'll reach them`;
      } else {
        list = [...decorated].sort(byNearest);
        note =
          'No route planned right now — showing nearest first. Start a truck route on the Map tab and the fuel along it will show here.';
      }
    } else if (sortMode === 'nearest') {
      list = [...decorated].sort(byNearest);
      if (!myPos) {
        note = locDenied
          ? 'Location is off — turn it on to sort by distance.'
          : 'Getting your location…';
      }
    } else {
      // Cheapest: priced stops first (price low→high, nearest breaks ties),
      // then stops with no known price by nearest. An unpriced stop is never
      // treated as cheap — it just has no price to rank.
      const priced = decorated
        .filter((d) => typeof d.stop.dieselPrice === 'number')
        .sort(
          (a, b) =>
            (a.stop.dieselPrice ?? Infinity) - (b.stop.dieselPrice ?? Infinity) ||
            byNearest(a, b),
        );
      const unpriced = decorated
        .filter((d) => typeof d.stop.dieselPrice !== 'number')
        .sort(byNearest);
      list = [...priced, ...unpriced];
      if (pricedCount === 0) {
        note =
          "Per-station pump prices aren't in the stop data yet, so there's nothing to rank by price — showing nearest first. Cheapest sorting and the CHEAPEST badge turn on automatically when price data arrives.";
      }
    }

    const rows: FuelRow[] = list.map((d) => {
      let distanceLabel: string | undefined;
      if (sortMode === 'route' && route && d.proj && d.aheadMi !== null) {
        distanceLabel =
          d.aheadMi < -0.1
            ? `${Math.abs(d.aheadMi).toFixed(1)} mi behind you on the route`
            : `${Math.max(d.aheadMi, 0).toFixed(1)} mi ahead on your route`;
        if (d.proj.offMi > 0.2) {
          distanceLabel += ` · ${d.proj.offMi.toFixed(1)} mi off route`;
        }
      } else if (d.straightMi !== null) {
        distanceLabel = `${d.straightMi.toFixed(1)} mi away`;
      }
      return {
        stop: d.stop,
        distanceLabel,
        priceLabel:
          typeof d.stop.dieselPrice === 'number'
            ? `$${d.stop.dieselPrice.toFixed(2)}/gal`
            : undefined,
        badge: cheapest && d.stop.id === cheapest.id ? 'CHEAPEST' : undefined,
      };
    });

    return { rows, note };
  }, [sortMode, route, myPos, locDenied]);

  return (
    <View style={shared.screen}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.stop.id}
        renderItem={({ item }) => (
          <StopCard
            stop={item.stop}
            distanceLabel={item.distanceLabel}
            priceLabel={item.priceLabel}
            badge={item.badge}
          />
        )}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <Text style={shared.title}>Fuel</Text>
            <Text style={shared.subtitle}>
              Diesel stops along your route — and the cheapest when a price is
              known.
            </Text>

            <View style={[shared.card, styles.hero]}>
              <Text style={styles.heroLabel}>US NATIONAL AVERAGE DIESEL</Text>
              <Text style={styles.heroPrice}>{money(SNAPSHOT.national)}</Text>
              <Text style={styles.heroUnit}>
                per gallon · {SNAPSHOT.source}, week of {SNAPSHOT.week}
              </Text>
            </View>

            <View style={styles.chipRow}>
              {SORT_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => chooseSort(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sortMode === opt.key }}
                  style={[
                    styles.chip,
                    sortMode === opt.key && styles.chipActive,
                  ]}>
                  <Text
                    style={[
                      styles.chipText,
                      sortMode === opt.key && styles.chipTextActive,
                    ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {note ? <Text style={styles.noteLine}>{note}</Text> : null}
            <Text style={styles.count}>
              {rows.length} fuel stop{rows.length === 1 ? '' : 's'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No fuel stops on this route</Text>
            <Text style={styles.emptyText}>
              No bundled diesel stops sit within {ALONG_ROUTE_TOLERANCE_MI}{' '}
              miles of your route. Switch to Nearest to see everything around
              you.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View>
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
                            r.price >= 7
                              ? colors.danger
                              : r.price >= 6.2
                                ? colors.primary
                                : colors.success,
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
                The averages are a static EIA snapshot — the benchmark most
                fuel surcharges are based on. The stop list above does not
                show per-station pump prices because the bundled stop data
                does not carry them yet. When a stop&apos;s price is known it
                appears on its card, the cheapest one gets the badge, and
                Cheapest sorting uses it. No price here is ever estimated or
                made up.
              </Text>
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
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
    fontSize: 13,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  chip: {
    backgroundColor: colors.surface2,
    borderColor: colors.surface2,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  noteLine: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
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
    lineHeight: 22,
    marginTop: spacing.xs,
    textAlign: 'center',
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
