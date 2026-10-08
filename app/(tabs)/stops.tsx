import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { StopCard } from '@/components/StopCard';
import { colors, shared, spacing } from '@/constants/theme';
import truckStopsJson from '@/data/truckStops.json';
import type { TruckStop } from '@/data/types';

const truckStops = truckStopsJson as TruckStop[];

export default function StopsScreen() {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return truckStops;
    return truckStops.filter((s) =>
      [s.name, s.city, s.state, s.chain, s.interstate, s.exit].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [query]);

  return (
    <View style={shared.screen}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StopCard stop={item} />}
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
              {filtered.length} of {truckStops.length} stops
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
