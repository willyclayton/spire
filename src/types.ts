export interface Building {
  id: string;
  name: string;
  lat: number;
  lon: number;
  heightM: number;
  floors?: number;
  yearCompleted?: number;
  architect?: string;
  style?: string;
  fact?: string;
  description?: string;
  wikipediaUrl?: string;
  prominence: number;
  imageUrl?: string;
}

export interface GeoPosition {
  lat: number;
  lon: number;
  accuracyM: number;
}

export interface Orientation {
  heading: number;
  pitch: number;
  confidence: 'high' | 'medium' | 'low';
  available: boolean;
}

export interface MatchLabel {
  building: Building;
  bearing: number;
  distanceM: number;
  elevationAngle: number;
  deltaFromHeading: number;
  x: number;
  y: number;
  score: number;
}
