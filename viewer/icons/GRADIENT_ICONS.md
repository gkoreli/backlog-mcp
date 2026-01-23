# Gradient Icon Library

All icons use the signature backlog-mcp gradient: **#00d4ff → #7b2dff → #ff2d7b**

## Icon Catalog

### 1. Lightning Bolt (Heavy Outline)
**Visual**: ⚡ Bold stroke lightning with gradient  
**Use Cases**:
- MCP resource links (`mcp://`)
- Fast operations
- Power features
- Real-time updates
- High-performance actions

**CSS Class**: `.icon-lightning-gradient`

---

### 2. Sparkle
**Visual**: ✨ Multi-point sparkle with gradient  
**Use Cases**:
- AI-generated content
- New features
- Highlighted items
- Special announcements
- Magic/automated actions
- Premium content

**CSS Class**: `.icon-sparkle-gradient`

---

### 3. Hexagon
**Visual**: ⬡ Geometric hexagon outline with gradient  
**Use Cases**:
- Protocol badges
- Standards/specifications
- Verified items
- Official documentation
- Architecture diagrams
- System components

**CSS Class**: `.icon-hexagon-gradient`

---

### 4. Lightning Bolt (Animated Glow)
**Visual**: ⚡ Lightning with pulsing gradient glow  
**Use Cases**:
- Active operations
- Live updates
- Real-time sync
- Processing indicators
- Dynamic content
- Attention-grabbing CTAs

**CSS Class**: `.icon-lightning-gradient-animated`

---

### 5. Rotating Ring
**Visual**: ⭕ Spinning gradient circle  
**Use Cases**:
- Loading states
- Active processes
- Continuous operations
- Background tasks
- Sync in progress
- Perpetual motion indicators

**CSS Class**: `.icon-ring-gradient-rotating`

---

### 6. Infinity Symbol
**Visual**: ∞ Infinity loop with gradient  
**Use Cases**:
- Unlimited features
- Continuous sync
- Infinite scroll
- Endless resources
- Perpetual access
- Subscription features

**CSS Class**: `.icon-infinity-gradient`

---

### 7. Wave/Signal
**Visual**: 📡 Radiating waves with gradient  
**Use Cases**:
- Broadcasting
- Notifications
- Signal transmission
- Communication features
- Network status
- API calls
- Event streaming

**CSS Class**: `.icon-wave-gradient`

---

### 8. Prism/Diamond
**Visual**: 💎 Multi-faceted diamond with gradient  
**Use Cases**:
- Premium features
- Valuable content
- Refined/curated items
- High-quality resources
- Exclusive access
- Pro/paid features

**CSS Class**: `.icon-prism-gradient`

---

### 9. Portal/Wormhole (Rotating)
**Visual**: 🌀 Concentric circles with spinning gradient  
**Use Cases**:
- Navigation shortcuts
- Quick access portals
- Teleportation/jumps
- Deep links
- Gateway features
- Cross-references
- Instant access

**CSS Class**: `.icon-portal-gradient-rotating`

---

### 10. Star/Rocket
**Visual**: 🚀 Star burst with gradient  
**Use Cases**:
- Launch features
- New releases
- Featured items
- Favorites/starred
- Trending content
- Achievements
- Milestones

**CSS Class**: `.icon-star-gradient`

---

## Usage Examples

### MCP Resources (Current)
```css
.markdown-body a[href^="mcp://"]::after {
  background: linear-gradient(135deg, #00d4ff 0%, #7b2dff 50%, #ff2d7b 100%);
  mask-image: var(--icon-lightning-gradient);
}
```

### AI-Generated Content
```css
.ai-generated::before {
  background: linear-gradient(135deg, #00d4ff 0%, #7b2dff 50%, #ff2d7b 100%);
  mask-image: var(--icon-sparkle-gradient);
}
```

### Loading State
```css
.loading::after {
  background: conic-gradient(from 0deg, #00d4ff, #7b2dff, #ff2d7b, #00d4ff);
  mask-image: var(--icon-ring-gradient-rotating);
  animation: spin 2s linear infinite;
}
```

---

## Design Principles

1. **Consistent Gradient**: All icons use the same cyan→purple→pink gradient
2. **Heavy Strokes**: Bold outlines (2-3px) for visibility and impact
3. **Semantic Meaning**: Each icon has clear use cases
4. **Animation Ready**: Some icons designed for rotation/pulse effects
5. **Scalable**: SVG-based, works at any size
6. **Accessible**: High contrast, clear shapes

---

## Future Ideas

- **Gradient Flame**: For hot/trending items
- **Gradient Shield**: For security features
- **Gradient Layers**: For stack/architecture views
- **Gradient Network**: For distributed systems
- **Gradient Clock**: For time-based features
- **Gradient Compass**: For navigation/discovery
