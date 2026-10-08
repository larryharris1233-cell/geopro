import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AmenityChips } from '@/components/AmenityChips';
import { darkMapStyle } from '@/constants/mapStyle';
import { colors, spacing } from '@/constants/theme';
import truckStopsJson from '@/data/truckStops.json';
import type { TruckStop } from '@/data/types';

interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

// react-native-maps has no web implementation — only load it on native.
let MapView: any = null;
let Marker: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
}

const truckStops = truckStopsJson as TruckStop[];

const INITIAL_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 30,
  longitudeDelta: 30,
};

export default function MapScreen() {
  const mapRef = useRef<any>(null);
  const [selected, setSelected] = useState<TruckStop | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  async function locateMe() {
    setLocating(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion(
        {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 3,
          longitudeDelta: 3,
        },
        800,
      );
    } catch {
      setLocationError('Could not get your location.');
    } finally {
      setLocating(false);
    }
  }

  function openDirections(stop: TruckStop) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}`;
    void Linking.openURL(url);
  }

  if (Platform.OS === 'web' || !MapView) {
    return (
      <View style={styles.webFallback}>
        <Ionicons name="map-outline" size={64} color={colors.muted} />
        <Text style={styles.webTitle}>Map needs the mobile app</Text>
        <Text style={styles.webText}>
          The live truck stop map runs on iOS and Android. The Truck Stops tab has
          the same {truckStops.length} locations as a searchable list.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={INITIAL_REGION}
        customMapStyle={darkMapStyle}
        showsUserLocation
        onPress={() => setSelected(null)}>
        {truckStops.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            pinColor={colors.chain[stop.chain] ?? colors.primary}
            title={stop.name}
            description={`${stop.interstate} ${stop.exit}`}
            onPress={() => setSelected(stop)}
          />
        ))}
      </MapView>

      <Pressable
        onPress={locateMe}
        accessibilityRole="button"
        accessibilityLabel="Center map on my location"
        style={({ pressed }) => [styles.locateButton, pressed && styles.pressed]}>
        {locating ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Ionicons name="locate-outline" size={28} color={colors.text} />
        )}
      </Pressable>

      {locationError ? (
        <View style={styles.errorToast}>
          <Text style={styles.errorText}>{locationError}</Text>
        </View>
      ) : null}

      {selected ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName}>{selected.name}</Text>
              <Text style={styles.cardRoute}>
                {selected.chain} · {selected.interstate} {selected.exit} ·{' '}
                {selected.city}, {selected.state}
              </Text>
            </View>
            <Pressable
              onPress={() => setSelected(null)}
              accessibilityRole="button"
              accessibilityLabel="Close stop details"
              hitSlop={12}
              style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>
          <AmenityChips amenities={selected.amenities} />
          <View style={styles.cardFooter}>
            <Text style={styles.phone}>{selected.phone}</Text>
            <Pressable
              onPress={() => openDirections(selected)}
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${selected.name}`}
              style={({ pressed }) => [styles.directions, pressed && styles.pressed]}>
              <Text style={styles.directionsText}>Directions →</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  locateButton: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 60,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    width: 60,
  },
  pressed: {
    opacity: 0.75,
  },
  errorToast: {
    alignSelf: 'center',
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    top: spacing.md,
  },
  errorText: {
    color: '#140A0A',
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    bottom: spacing.md,
    left: spacing.md,
    padding: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardName: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  cardRoute: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFooter: {
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
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  directionsText: {
    color: '#14100A',
    fontSize: 16,
    fontWeight: '800',
  },
  webFallback: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  webTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  webText: {
    color: colors.muted,
    fontSize: 16,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
