import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { AMENITY_LABELS, type Amenity } from '@/data/types';

export function AmenityChips({ amenities }: { amenities: Amenity[] }) {
  return (
    <View style={styles.row}>
      {amenities.map((a) => (
        <View key={a} style={styles.chip}>
          <Text style={styles.chipText}>{AMENITY_LABELS[a]}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
});
