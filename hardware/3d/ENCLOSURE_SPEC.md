# CryptoExam Core — Hardware Security Node 3D Model

## Enclosure Specifications

| Parameter | Value |
|-----------|-------|
| Material | 6061-T6 Aluminum |
| Finish | Black anodized, Type II |
| Dimensions | 120 x 95 x 35 mm (external) |
| Wall thickness | 3mm |
| Manufacturing | CNC machined from solid billet |
| Weight | ~280g (empty), ~350g (assembled) |
| IP Rating | IP54 (dust + splash protected) |
| Operating temp | -10C to +55C |
| Mounting | 4x M4 threaded inserts (bottom), DIN rail clip optional |

## Design Features

### Security
- **Tamper-evident screws**: Torx T8 with pin (non-standard)
- **Tamper mesh channel**: Internal groove for Kapton flex cable routing
- **Break-away tabs**: Visible fracture points if lid is pried
- **Potting compound**: Critical crypto ICs potted in opaque epoxy

### Thermal
- **Heatsink fins**: Machined into lid, aligned over CM4 SoC
- **Thermal pad**: 1.5mm Laird T-flex 300 between CM4 and lid
- **Ventilation**: Filtered slots on sides (IP54 compliant)

### Connectors (accessible through sealed gaskets)
- USB-C (power + data): Left panel
- RJ45 Ethernet: Right panel
- SMA GPS antenna: Top panel
- Status LED window: Front panel (polycarbonate, sealed)
- TFT display window: Front panel (Gorilla Glass, sealed)

### Manufacturing
- **Tolerance**: +/- 0.1mm
- **Surface finish**: Ra 1.6um
- **Thread inserts**: Heli-Coil M3 for PCB mounting, M4 for enclosure
- **Gaskets**: Silicone O-ring, 50 Shore A

## Assembly Order
1. Insert Heli-Coil thread inserts
2. Place silicone gasket in lid groove
3. Mount PCB to base with M3 standoffs (4x 8mm)
4. Route tamper mesh flex cable through channel
5. Connect FPC cables (display, tamper)
6. Apply thermal pad to CM4
7. Close lid, secure with Torx T8 pin screws (x6)
8. Apply tamper-evident labels over screws
9. Attach DIN rail clip (optional)
10. Connect GPS antenna to SMA
