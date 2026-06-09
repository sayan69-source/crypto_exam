# CryptoExam Core — Hardware Security Node Bill of Materials (BOM)
# 4-layer PCB with tamper-evident security mesh
# Designed for field deployment at Indian exam centers (6,000+ locations)

| Ref | Component | Part Number | Package | Qty | Unit Price (USD) | Description |
|-----|-----------|-------------|---------|-----|-----------------|-------------|
| U1 | Raspberry Pi CM4 | CM4104032 | DDR4-SODIMM | 1 | $55.00 | Compute Module 4, 4GB RAM, 32GB eMMC, WiFi |
| U2 | Infineon TPM 2.0 | SLB9670XQ20FW | VQFN-32 | 1 | $4.80 | Trusted Platform Module 2.0, SPI interface |
| U3 | u-blox GPS | NEO-M9N-00B | LCC-24 | 1 | $12.50 | Multi-band GNSS, GPS/GLONASS/BeiDou, 1PPS |
| U4 | Microchip Crypto Auth | ATECC608A-MAHDA | UDFN-8 | 1 | $0.72 | Secure element, ECDSA/ECDH, I2C |
| U5 | TFT Display Driver | ST7789V2 | QFP-48 | 1 | $2.10 | 240x320 RGB TFT driver, SPI |
| U6 | Voltage Regulator 3.3V | AMS1117-3.3 | SOT-223 | 2 | $0.15 | 3.3V LDO, 1A output |
| U7 | Voltage Regulator 1.8V | AMS1117-1.8 | SOT-223 | 1 | $0.15 | 1.8V LDO for TPM core |
| U8 | USB-C PD Controller | FUSB302B | WLCSP-9 | 1 | $1.20 | USB PD negotiation |
| U9 | Level Shifter | TXB0108 | TSSOP-20 | 1 | $0.90 | 8-bit bidirectional, 1.8V-3.3V |
| U10 | RTC | DS3231SN | SOIC-16 | 1 | $3.50 | ±2ppm TCXO, I2C, battery backup |
| U11 | Ethernet PHY | LAN8720A | QFN-24 | 1 | $1.80 | 10/100 Mbps, RMII |
| Y1 | Crystal 25MHz | ABM8-25.000 | 3.2x2.5mm | 1 | $0.30 | For Ethernet PHY |
| Y2 | Crystal 32.768kHz | ABS07-32.768 | 3.2x1.5mm | 1 | $0.20 | For RTC backup |
| D1 | Status LED RGB | WS2812B-V5 | 5050 | 3 | $0.10 | Addressable RGB (status/tamper/network) |
| D2 | TVS Diode | PESD5V0U1BA | SOD-523 | 4 | $0.08 | USB/GPIO ESD protection |
| C1-C20 | Decoupling Caps | Various | 0402/0603 | 20 | $0.01 | 100nF/10uF MLCC |
| C21 | Supercapacitor | DSK-3R3H504T614-H2L | Radial 10mm | 1 | $3.50 | 3.3V 500mF, tamper data preservation |
| C22 | Supercap (UPS) | EDLC 50F/2.7V | Coin cell | 1 | $8.00 | 50F supercapacitor, 30s graceful shutdown |
| R1-R10 | Resistors | Various | 0402 | 10 | $0.005 | Pull-ups, current limiters |
| J1 | USB-C Connector | USB4105-GF-A | SMD | 1 | $0.50 | 24-pin, USB 2.0 + PD |
| J2 | RJ45 Ethernet | HR911105A | Through-hole | 1 | $0.80 | 10/100 with magnetics |
| J3 | MicroSD Slot | DM3AT-SF-PEJM5 | SMD | 1 | $0.60 | Push-push, for firmware updates |
| J4 | SMA Antenna | SMA-KE | Edge mount | 1 | $0.40 | GPS external antenna |
| J5 | CM4 Connector | DF40C-100DS-0.4V | Board-to-board | 2 | $1.50 | 100-pin CM4 interface |
| SW1 | Tamper Switch | D2F-01 | Through-hole | 4 | $0.30 | Omron micro switch (tamper mesh) |
| F1 | Polyfuse | MF-MSMF050 | 1206 | 1 | $0.10 | 500mA resettable |
| ANT1 | GPS Antenna | MAANT1575F | Patch | 1 | $2.50 | 1575.42MHz, 25x25mm |
| PCB | 4-Layer PCB | Custom | 100x80mm | 1 | $5.00 | FR-4, 1.6mm, ENIG finish |
| MESH | Tamper Mesh | Custom flex | Kapton | 1 | $3.00 | Serpentine Cu trace on flex PCB |
| ENC | Enclosure | Custom CNC | 6061-T6 Al | 1 | $25.00 | CNC machined, anodized black |

## Total BOM Cost: ~$138.50 per unit (prototype qty)
## At 1000+ units: ~$85-95 per unit

## Key Design Decisions:
1. **CM4 over Pi 4**: Industrialized form factor, board-to-board connectors, proper EMI
2. **Infineon SLB9670**: Only TPM 2.0 with SPI that meets Common Criteria EAL4+
3. **u-blox NEO-M9N**: Multi-constellation GNSS with 1PPS for UTC time derivation
4. **ATECC608A**: Hardware secure element for key storage — cannot be extracted even with decap
5. **50F supercapacitor**: Guarantees 30s graceful shutdown for data preservation on power loss
6. **Tamper mesh**: Serpentine trace on Kapton flex — any break zeros the keys via interrupt
