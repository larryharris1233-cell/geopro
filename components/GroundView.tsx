import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  fetchNearestGroundPhoto,
  fetchSequenceGroundPhotos,
  mapillaryEnabled,
  type GroundPhoto,
} from '@/constants/mapillary';
import { colors, spacing } from '@/constants/theme';

// Street-level "ground view" for map cards (build #14, Larry's
// Google-Maps-style flow): when a card opens for a place, look for a
// Mapillary photo near it. If one exists, the card gets a thumbnail
// strip; tapping it opens the full-screen viewer below, which steps
// forward/back along the road through the same photo sequence.
// Renders NOTHING when no token is configured or no photo exists
// nearby — silent by design, never an error or a dead button.

export function GroundViewLink({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  // The lookup result is tagged with the point it belongs to, so a
  // slow answer for a previous card can never render on this one.
  const [found, setFound] = useState<{
    latitude: number;
    longitude: number;
    photo: GroundPhoto;
  } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    if (!mapillaryEnabled()) return;
    let cancelled = false;
    void fetchNearestGroundPhoto(latitude, longitude).then((result) => {
      if (cancelled) return;
      setFound(result ? { latitude, longitude, photo: result } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  const photo =
    found && found.latitude === latitude && found.longitude === longitude
      ? found.photo
      : null;

  if (!mapillaryEnabled() || !photo) return null;

  return (
    <>
      <Pressable
        onPress={() => setViewerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="See the street-level ground view of this spot"
        style={({ pressed }) => [styles.thumbRow, pressed && styles.pressed]}>
        <Image source={{ uri: photo.thumbUrl }} style={styles.thumb} />
        <View style={styles.thumbTextWrap}>
          <Text style={styles.thumbTitle}>Ground view</Text>
          <Text style={styles.thumbSub} numberOfLines={1}>
            Street-level photo of this spot — tap to look around
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
      {viewerOpen ? (
        <GroundViewViewer anchor={photo} onClose={() => setViewerOpen(false)} />
      ) : null}
    </>
  );
}

function formatCaptured(capturedAt: number | null): string | null {
  if (!capturedAt) return null;
  const date = new Date(capturedAt);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function GroundViewViewer({
  anchor,
  onClose,
}: {
  anchor: GroundPhoto;
  onClose: () => void;
}) {
  const [photos, setPhotos] = useState<GroundPhoto[]>([anchor]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const anchorId = useRef(anchor.id);

  useEffect(() => {
    let cancelled = false;
    void fetchSequenceGroundPhotos(anchor).then((list) => {
      if (cancelled) return;
      const at = list.findIndex((p) => p.id === anchorId.current);
      setPhotos(list);
      setIndex(at >= 0 ? at : 0);
      setLoading(false);
      // Warm the neighbours so stepping feels instant.
      for (const p of [list[at - 1], list[at + 1]]) {
        if (p) void Image.prefetch(p.fullUrl);
      }
    });
    return () => {
      cancelled = true;
    };
    // The anchor is fixed for the life of this viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = photos[Math.min(index, photos.length - 1)];
  const captured = formatCaptured(current?.capturedAt ?? null);

  function step(delta: number) {
    setIndex((cur) => {
      const next = Math.min(Math.max(cur + delta, 0), photos.length - 1);
      if (next !== cur) {
        setImageLoading(true);
        const ahead = photos[next + delta];
        if (ahead) void Image.prefetch(ahead.fullUrl);
      }
      return next;
    });
  }

  if (!current) return null;

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.viewerRoot}>
        <Image
          key={current.id}
          source={{ uri: current.fullUrl }}
          style={styles.viewerImage}
          resizeMode="contain"
          onLoadEnd={() => setImageLoading(false)}
        />
        {(loading || imageLoading) && (
          <View style={styles.viewerSpinner} pointerEvents="none">
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}

        {/* Top bar: capture date on the left, close on the right. */}
        <View style={styles.viewerTopBar}>
          <View style={styles.viewerDateChip}>
            <Ionicons name="camera-outline" size={16} color={colors.text} />
            <Text style={styles.viewerDateText}>
              {captured ? `Photo · ${captured}` : 'Street-level photo'}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close ground view"
            hitSlop={10}
            style={styles.viewerClose}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>

        {/* Google-style step arrows, mid-height on each side. */}
        {index > 0 ? (
          <Pressable
            onPress={() => step(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous photo back along the road"
            style={[styles.stepButton, styles.stepLeft]}>
            <Ionicons name="chevron-back" size={34} color={colors.text} />
          </Pressable>
        ) : null}
        {index < photos.length - 1 ? (
          <Pressable
            onPress={() => step(1)}
            accessibilityRole="button"
            accessibilityLabel="Next photo forward along the road"
            style={[styles.stepButton, styles.stepRight]}>
            <Ionicons name="chevron-forward" size={34} color={colors.text} />
          </Pressable>
        ) : null}

        {/* Bottom bar: position in the sequence + CC BY-SA credit. */}
        <View style={styles.viewerBottomBar}>
          <Text style={styles.viewerPosition}>
            {photos.length > 1
              ? `Photo ${index + 1} of ${photos.length} along this road`
              : 'Only photo of this spot nearby'}
          </Text>
          <Text style={styles.viewerAttribution}>
            Street-level imagery © Mapillary contributors · CC BY-SA
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  thumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.75 },
  thumb: {
    width: 84,
    height: 56,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  thumbTextWrap: { flex: 1 },
  thumbTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  thumbSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  viewerRoot: { flex: 1, backgroundColor: '#000' },
  viewerImage: { flex: 1, width: '100%' },
  viewerSpinner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 44,
    paddingHorizontal: spacing.md,
  },
  viewerDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,14,20,0.8)',
    borderRadius: 999,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  viewerDateText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  viewerClose: {
    backgroundColor: 'rgba(11,14,20,0.8)',
    borderRadius: 999,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: 'rgba(11,14,20,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLeft: { left: spacing.sm },
  stepRight: { right: spacing.sm },
  viewerBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 30,
    backgroundColor: 'rgba(11,14,20,0.8)',
  },
  viewerPosition: { color: colors.text, fontSize: 13, fontWeight: '600' },
  viewerAttribution: { color: colors.muted, fontSize: 11, marginTop: 3 },
});
