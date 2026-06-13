"""
CryptoExam Core — Database Seeder
Creates demo data for the platform so the frontend has real data to consume.

Seeds:
  - Admin, Setter, and Candidate users
  - Demo exams (NEET 2026, JEE Main 2026, SSC CGL 2026)
  - Exam centers across India
  - Hardware nodes
  - Sample enrollments
  - Sample questions with IRT parameters

All data is DPDP Act 2023 compliant:
  - No real PII
  - Biometric hashes are synthetic
  - Consent timestamps recorded
"""

import hashlib
import logging
import os
import random
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import (
    User, UserRole, Exam, ExamStatus, ExamBody, ExamType,
    Question, QuestionSource, Center, HardwareNode, NodeStatus,
    Enrollment, EnrollmentStatus, ConnectivityTier,
    Session, Anomaly, AnomalyType,
    BiometricEnrollment, CandidateVerification, VerificationResultEnum,
)
from app.services.auth import hash_password


def _synthetic_embedding(seed: str, dim: int = 256) -> list[float]:
    """
    Deterministic synthetic face embedding (L2-normalised), derived from a seed.
    DPDP: synthetic vector only — never a real face. Used for demo enrollment.
    """
    rng = random.Random(seed)
    vec = [rng.gauss(0, 1) for _ in range(dim)]
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [round(v / norm, 6) for v in vec]

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════
# Indian States for Center Distribution
# ═══════════════════════════════════════════════════════

INDIA_STATES = [
    ("Delhi (NCT)", "New Delhi", 28.6139, 77.2090),
    ("Maharashtra", "Mumbai", 19.0760, 72.8777),
    ("Karnataka", "Bengaluru", 12.9716, 77.5946),
    ("Tamil Nadu", "Chennai", 13.0827, 80.2707),
    ("West Bengal", "Kolkata", 22.5726, 88.3639),
    ("Telangana", "Hyderabad", 17.3850, 78.4867),
    ("Gujarat", "Ahmedabad", 23.0225, 72.5714),
    ("Rajasthan", "Jaipur", 26.9124, 75.7873),
    ("Uttar Pradesh", "Lucknow", 26.8467, 80.9462),
    ("Bihar", "Patna", 25.6093, 85.1376),
    ("Madhya Pradesh", "Bhopal", 23.2599, 77.4126),
    ("Punjab", "Chandigarh", 30.7333, 76.7794),
    ("Kerala", "Thiruvananthapuram", 8.5241, 76.9366),
    ("Assam", "Guwahati", 26.1445, 91.7362),
    ("Odisha", "Bhubaneswar", 20.2961, 85.8245),
    ("Jharkhand", "Ranchi", 23.3441, 85.3096),
]

NEET_SUBJECTS = [
    {"name": "Physics", "topics": [
        {"name": "Kinematics", "count": 5},
        {"name": "Laws of Motion", "count": 5},
        {"name": "Thermodynamics", "count": 5},
    ]},
    {"name": "Chemistry", "topics": [
        {"name": "Atomic Structure", "count": 5},
        {"name": "Chemical Bonding", "count": 5},
        {"name": "Organic Chemistry", "count": 5},
    ]},
    {"name": "Biology", "topics": [
        {"name": "Cell Biology", "count": 5},
        {"name": "Genetics", "count": 5},
        {"name": "Human Physiology", "count": 5},
    ]},
]


async def seed_database(db: AsyncSession) -> dict:
    """
    Seed the database with comprehensive demo data.
    Returns a summary of what was created.
    """
    summary = {}

    # Check if already seeded
    existing = await db.execute(select(User).limit(1))
    if existing.scalar_one_or_none():
        logger.info("Database already seeded — skipping")
        return {"status": "already_seeded"}

    logger.info("═" * 60)
    logger.info("CryptoExam Core — Seeding Database")
    logger.info("═" * 60)

    # ── 1. Users ──
    users = await _seed_users(db)
    summary["users"] = len(users)

    # ── 2. Centers ──
    centers = await _seed_centers(db)
    summary["centers"] = len(centers)

    # ── 3. Hardware Nodes ──
    nodes = await _seed_hardware_nodes(db, centers)
    summary["hardware_nodes"] = len(nodes)

    # ── 4. Exams ──
    exams = await _seed_exams(db, users)
    summary["exams"] = len(exams)

    # ── 5. Questions ──
    questions_count = await _seed_questions(db, exams)
    summary["questions"] = questions_count

    # ── 6. Enrollments ──
    enrollments = await _seed_enrollments(db, users, exams, centers)
    summary["enrollments"] = len(enrollments)

    # ── 7. § 29 Invigilator + biometric enrollments ──
    bio = await _seed_invigilator_biometrics(db, users, centers, enrollments)
    summary["biometric_enrollments"] = bio

    await db.flush()

    logger.info("═" * 60)
    logger.info(f"Seeding complete: {summary}")
    logger.info("═" * 60)

    return summary


async def _seed_users(db: AsyncSession) -> list[User]:
    """Create admin, setter, and candidate users."""
    users = []
    now = datetime.now(timezone.utc)

    # Admin
    admin = User(
        id=str(uuid4()),
        email="admin@cryptoexam.dev",
        full_name="CryptoExam Admin",
        name_hi="क्रिप्टोएक्ज़ाम एडमिन",
        role=UserRole.ADMIN,
        phone=os.getenv("SEED_ADMIN_PHONE", "+91 90000 00001"),
        # Override in production so the public demo password is never live.
        password_hash=hash_password(os.getenv("SEED_ADMIN_PASSWORD", "CryptoExam2025!")),
        dpdp_consent=True,
        dpdp_consent_at=now,
        dpdp_consent_version="1.0",
        state="Delhi (NCT)",
        is_active=True,
    )
    db.add(admin)
    users.append(admin)

    # Setters
    setters_data = [
        ("Dr. Priya Sharma", "डॉ. प्रिया शर्मा", "setter@cryptoexam.dev", "IIT Delhi", "Delhi (NCT)"),
        ("Prof. Anand Kumar", "प्रो. आनंद कुमार", "anand@cryptoexam.dev", "IIT Bombay", "Maharashtra"),
        ("Dr. Meera Iyer", "डॉ. मीरा अय्यर", "meera@cryptoexam.dev", "IISc Bangalore", "Karnataka"),
    ]
    for si, (name, name_hi, email, inst, state) in enumerate(setters_data):
        setter = User(
            id=str(uuid4()),
            email=email,
            full_name=name,
            name_hi=name_hi,
            role=UserRole.SETTER,
            phone=f"+91 90000 1{si:04d}"[:14],
            password_hash=hash_password("CryptoExam2025!"),
            institution=inst,
            dpdp_consent=True,
            dpdp_consent_at=now,
            dpdp_consent_version="1.0",
            state=state,
            is_active=True,
        )
        db.add(setter)
        users.append(setter)

    # Candidates (15 demo candidates across India)
    candidate_names = [
        ("Rahul Verma", "राहुल वर्मा", "Delhi (NCT)"),
        ("Sneha Patel", "स्नेहा पटेल", "Gujarat"),
        ("Arjun Nair", "अर्जुन नायर", "Kerala"),
        ("Priya Devi", "प्रिया देवी", "Bihar"),
        ("Karthik Rajan", "कार्तिक राजन", "Tamil Nadu"),
        ("Aisha Khan", "आइशा खान", "Uttar Pradesh"),
        ("Vikram Singh", "विक्रम सिंह", "Rajasthan"),
        ("Lakshmi Menon", "लक्ष्मी मेनन", "Karnataka"),
        ("Rohit Das", "रोहित दास", "West Bengal"),
        ("Anjali Sharma", "अंजली शर्मा", "Madhya Pradesh"),
        ("Deepak Yadav", "दीपक यादव", "Maharashtra"),
        ("Fatima Begum", "फातिमा बेगम", "Telangana"),
        ("Suresh Kumar", "सुरेश कुमार", "Punjab"),
        ("Riya Ghosh", "रिया घोष", "Odisha"),
        ("Manish Jha", "मनीष झा", "Jharkhand"),
    ]
    for i, (name, name_hi, state) in enumerate(candidate_names):
        # A real, varied DOB per candidate. It is BOTH the public candidate login
        # factor (roll number + DOB) AND what gets provisioned to the centre Edge,
        # so the same credential works online and offline.
        dob = f"{2004 + (i % 4)}-{(i % 12) + 1:02d}-{(i % 27) + 1:02d}"  # YYYY-MM-DD
        candidate = User(
            id=str(uuid4()),
            email=f"candidate{i+1}@cryptoexam.dev",
            full_name=name,
            name_hi=name_hi,
            role=UserRole.CANDIDATE,
            phone=f"+91 9{(700000000 + i):09d}"[:14],
            date_of_birth=dob,
            password_hash=hash_password(dob),   # candidate "password" == DOB
            dpdp_consent=True,
            dpdp_consent_at=now,
            dpdp_consent_version="1.0",
            state=state,
            district=state,
            is_active=True,
        )
        db.add(candidate)
        users.append(candidate)

    logger.info(f"Created {len(users)} users (1 admin, 3 setters, 15 candidates)")
    return users


async def _seed_centers(db: AsyncSession) -> list[Center]:
    """Create exam centers across India."""
    centers = []
    tiers = [ConnectivityTier.TIER_1_METRO, ConnectivityTier.TIER_2_4G,
             ConnectivityTier.TIER_3_BSNL]

    for i, (state, city, lat, lng) in enumerate(INDIA_STATES):
        center = Center(
            id=str(uuid4()),
            name=f"CryptoExam Center {city}",
            state=state,
            city=city,
            district=city,
            latitude=lat,
            longitude=lng,
            capacity=200 + random.randint(0, 300),
            invigilator_name=f"Chief Invigilator {city}",
            invigilator_phone=f"+91 98{random.randint(10000000, 99999999)}",
            connectivity=tiers[i % len(tiers)],
            isp="BSNL" if i % 3 == 2 else "Jio" if i % 3 == 1 else "Airtel",
        )
        db.add(center)
        centers.append(center)

    logger.info(f"Created {len(centers)} exam centers")
    return centers


async def _seed_hardware_nodes(db: AsyncSession, centers: list[Center]) -> list[HardwareNode]:
    """Create hardware security nodes for each center."""
    nodes = []

    for i, center in enumerate(centers):
        node = HardwareNode(
            id=str(uuid4()),
            center_id=center.id,
            serial_number=f"CEX-{center.state[:3].upper()}-{i+1:03d}",
            tpm_ek_cert_hash=hashlib.sha256(f"TPM-EK-{center.id}".encode()).digest(),
            gps_calibration={
                "latitude": float(center.latitude),
                "longitude": float(center.longitude),
                "accuracy_m": 5.0,
            },
            firmware_version="2.1.0",
            last_heartbeat=datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 30)),
            status=random.choice([NodeStatus.ARMED, NodeStatus.ARMED, NodeStatus.OFFLINE]),
            battery_percent=random.randint(60, 100),
            deployed_at=datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30)),
        )
        db.add(node)
        nodes.append(node)

    logger.info(f"Created {len(nodes)} hardware nodes")
    return nodes


async def _seed_exams(db: AsyncSession, users: list[User]) -> list[Exam]:
    """Create demo exams in various lifecycle stages."""
    exams = []
    setters = [u for u in users if u.role == UserRole.SETTER]
    now = datetime.now(timezone.utc)

    exams_data = [
        {
            "name": "NEET UG 2026 — Mock Examination",
            "name_hi": "नीट यूजी 2026 — मॉक परीक्षा",
            "body": ExamBody.NTA,
            "type": ExamType.ONLINE_CBT,
            "duration": 200,
            "scheduled": now + timedelta(hours=2),
            "status": ExamStatus.LIVE,
            "subjects": NEET_SUBJECTS,
        },
        {
            "name": "JEE Main 2026 — Session 1",
            "name_hi": "जेईई मेन 2026 — सत्र 1",
            "body": ExamBody.NTA,
            "type": ExamType.ONLINE_CBT,
            "duration": 180,
            "scheduled": now + timedelta(days=3),
            "status": ExamStatus.LOCKED,
            "subjects": [
                {"name": "Physics", "topics": [{"name": "Mechanics", "count": 10}]},
                {"name": "Chemistry", "topics": [{"name": "Physical Chemistry", "count": 10}]},
                {"name": "Mathematics", "topics": [{"name": "Calculus", "count": 10}]},
            ],
        },
        {
            "name": "SSC CGL 2026 — Tier I",
            "name_hi": "एसएससी सीजीएल 2026 — टियर I",
            "body": ExamBody.SSC,
            "type": ExamType.ONLINE_CBT,
            "duration": 60,
            "scheduled": now + timedelta(days=7),
            "status": ExamStatus.GENERATING,
            "subjects": [
                {"name": "Reasoning", "topics": [{"name": "Logical Reasoning", "count": 8}]},
                {"name": "Quantitative Aptitude", "topics": [{"name": "Arithmetic", "count": 8}]},
                {"name": "English", "topics": [{"name": "Comprehension", "count": 8}]},
                {"name": "General Awareness", "topics": [{"name": "Current Affairs", "count": 8}]},
            ],
        },
        {
            "name": "UPSC Civil Services 2026 — Prelims GS Paper I",
            "name_hi": "यूपीएससी सिविल सेवा 2026 — प्रारंभिक जीएस पेपर I",
            "body": ExamBody.UPSC,
            "type": ExamType.ONLINE_CBT,
            "duration": 120,
            "scheduled": now + timedelta(days=14),
            "status": ExamStatus.DRAFT,
            "subjects": [
                {"name": "General Studies", "topics": [
                    {"name": "History", "count": 5},
                    {"name": "Geography", "count": 5},
                    {"name": "Polity", "count": 5},
                    {"name": "Economy", "count": 5},
                ]},
            ],
        },
        {
            "name": "CUET UG 2026 — Domain Subject Test",
            "name_hi": "सीयूईटी यूजी 2026 — डोमेन विषय परीक्षा",
            "body": ExamBody.NTA,
            "type": ExamType.ONLINE_CBT,
            "duration": 60,
            "scheduled": now - timedelta(days=2),
            "status": ExamStatus.COMPLETED,
            "subjects": [
                {"name": "Domain Subject", "topics": [{"name": "General", "count": 15}]},
            ],
        },
    ]

    for i, ed in enumerate(exams_data):
        # Generate question hash for locked/live/completed exams
        q_hash = None
        zk_hash = None
        merkle_root = None
        poly_tx = None

        if ed["status"] in (ExamStatus.LOCKED, ExamStatus.LIVE, ExamStatus.COMPLETED):
            q_hash = hashlib.sha256(f"paper-{ed['name']}".encode()).digest()
            zk_hash = hashlib.sha256(f"zkproof-{ed['name']}".encode()).digest()
            poly_tx = "0x" + hashlib.sha256(f"tx-lock-{ed['name']}".encode()).hexdigest()

        if ed["status"] == ExamStatus.COMPLETED:
            merkle_root = hashlib.sha256(f"merkle-{ed['name']}".encode()).digest()

        exam = Exam(
            id=str(uuid4()),
            name=ed["name"],
            name_hi=ed["name_hi"],
            exam_body=ed["body"],
            exam_type=ed["type"],
            duration_minutes=ed["duration"],
            scheduled_at=ed["scheduled"],
            status=ed["status"],
            setter_id=setters[i % len(setters)].id,
            sets_count=4,
            negative_marking=0.25,
            subject_taxonomy={"subjects": ed["subjects"]},
            irt_config={
                "target_mean_b": 0.2,
                "target_std_b": 0.8,
                "min_a": 1.0,
                "max_c": 0.25,
                "tolerance": 1.0,
            },
            blooms_config={
                "REMEMBER": 0.20,
                "UNDERSTAND": 0.25,
                "APPLY": 0.30,
                "ANALYZE": 0.15,
                "EVALUATE": 0.07,
                "CREATE": 0.03,
            },
            question_hash=q_hash,
            zk_proof_hash=zk_hash,
            answer_merkle_root=merkle_root,
            polygon_exam_tx=poly_tx,
            drand_round=random.randint(10000000, 99999999) if q_hash else None,
        )
        db.add(exam)
        exams.append(exam)

    logger.info(f"Created {len(exams)} exams")
    return exams


async def _seed_questions(db: AsyncSession, exams: list[Exam]) -> int:
    """Create sample questions for each exam."""
    total = 0

    sample_questions = [
        {
            "text": "A body of mass 5 kg is moving with a velocity of 10 m/s. What is its kinetic energy?",
            "text_hi": "5 किलोग्राम द्रव्यमान का एक पिंड 10 मीटर/सेकंड के वेग से गतिशील है। इसकी गतिज ऊर्जा क्या है?",
            "options": {"A": "250 J", "B": "500 J", "C": "100 J", "D": "50 J"},
            "correct": "A",
            "subject": "Physics",
            "topic": "Kinematics",
            "blooms": 3,
        },
        {
            "text": "Which quantum number determines the shape of an orbital?",
            "text_hi": "कौन सी क्वांटम संख्या कक्षक के आकार को निर्धारित करती है?",
            "options": {"A": "Principal (n)", "B": "Azimuthal (l)", "C": "Magnetic (ml)", "D": "Spin (ms)"},
            "correct": "B",
            "subject": "Chemistry",
            "topic": "Atomic Structure",
            "blooms": 1,
        },
        {
            "text": "The powerhouse of the cell is:",
            "text_hi": "कोशिका का पावरहाउस है:",
            "options": {"A": "Nucleus", "B": "Ribosome", "C": "Mitochondria", "D": "Golgi apparatus"},
            "correct": "C",
            "subject": "Biology",
            "topic": "Cell Biology",
            "blooms": 1,
        },
        {
            "text": "A projectile is launched at 60° with a speed of 20 m/s. What is the maximum height reached? (g = 10 m/s²)",
            "text_hi": "एक प्रक्षेप्य 60° कोण पर 20 मी/से वेग से छोड़ा जाता है। अधिकतम ऊँचाई क्या है? (g = 10 मी/से²)",
            "options": {"A": "15 m", "B": "10 m", "C": "20 m", "D": "5 m"},
            "correct": "A",
            "subject": "Physics",
            "topic": "Kinematics",
            "blooms": 3,
        },
        {
            "text": "Benzene undergoes which type of reaction preferentially?",
            "text_hi": "बेंजीन मुख्य रूप से किस प्रकार की अभिक्रिया करता है?",
            "options": {"A": "Addition", "B": "Substitution", "C": "Elimination", "D": "Rearrangement"},
            "correct": "B",
            "subject": "Chemistry",
            "topic": "Organic Chemistry",
            "blooms": 2,
        },
        {
            "text": "Which of the following is NOT a component of DNA?",
            "text_hi": "निम्नलिखित में से कौन DNA का घटक नहीं है?",
            "options": {"A": "Adenine", "B": "Uracil", "C": "Guanine", "D": "Cytosine"},
            "correct": "B",
            "subject": "Biology",
            "topic": "Genetics",
            "blooms": 1,
        },
    ]

    for exam in exams:
        if exam.status == ExamStatus.DRAFT:
            continue

        for i, sq in enumerate(sample_questions):
            for set_label in ["A", "B", "C", "D"]:
                question = Question(
                    id=str(uuid4()),
                    exam_id=exam.id,
                    set_label=set_label,
                    sequence_number=i + 1,
                    text=sq["text"],
                    text_hi=sq["text_hi"],
                    options=sq["options"],
                    correct_option=sq["correct"],
                    subject=sq["subject"],
                    topic=sq["topic"],
                    blooms_level=sq["blooms"],
                    irt_b=round(random.gauss(0.2, 0.8), 3),
                    irt_a=round(random.uniform(0.8, 2.5), 3),
                    irt_c=round(random.uniform(0.15, 0.25), 3),
                    source=QuestionSource.AI_GENERATED,
                    generation_model="mock-bank",
                    is_accepted=True,
                )
                db.add(question)
                total += 1

    logger.info(f"Created {total} questions")
    return total


async def _seed_invigilator_biometrics(
    db: AsyncSession,
    users: list[User],
    centers: list[Center],
    enrollments: list[Enrollment],
) -> int:
    """
    § 29 — Seed a demo invigilator (biometric login) plus biometric enrollments
    for the first candidates so candidate verification works against the backend.
    DPDP: only synthetic embeddings and template hashes are stored.
    """
    import pyotp
    now = datetime.now(timezone.utc)
    count = 0

    invig = User(
        id=str(uuid4()),
        email="invigilator@cryptoexam.dev",
        full_name="Smt. Lakshmi Bora",
        name_hi="श्रीमती लक्ष्मी बोरा",
        role=UserRole.INVIGILATOR,
        password_hash=hash_password("CryptoExam2025!"),
        totp_secret=pyotp.random_base32(),
        dpdp_consent=True,
        dpdp_consent_at=now,
        dpdp_consent_version="1.0",
        state=centers[0].state if centers else "Delhi (NCT)",
        is_active=True,
    )
    db.add(invig)

    db.add(BiometricEnrollment(
        id=str(uuid4()),
        user_id=invig.id,
        center_id=centers[0].id if centers else None,
        face_embedding=_synthetic_embedding(f"invig-{invig.email}"),
        fp_template_hash=hashlib.sha256(f"fp-{invig.email}".encode()).hexdigest(),
        webauthn_credential_id=f"cred-{invig.id}",
        webauthn_sign_count=0,
        expires_at=now + timedelta(days=2),
    ))
    count += 1

    # Biometric enrollments for the first 8 candidates
    candidates = [u for u in users if u.role == UserRole.CANDIDATE][:8]
    for c in candidates:
        db.add(BiometricEnrollment(
            id=str(uuid4()),
            user_id=c.id,
            center_id=centers[0].id if centers else None,
            face_embedding=_synthetic_embedding(f"cand-{c.email}"),
            fp_template_hash=hashlib.sha256(f"fp-{c.email}".encode()).hexdigest(),
            webauthn_credential_id=f"cred-{c.id}",
            expires_at=now + timedelta(days=2),
        ))
        count += 1

    logger.info(f"Created 1 invigilator + {count} biometric enrollments")
    return count


async def _seed_enrollments(
    db: AsyncSession,
    users: list[User],
    exams: list[Exam],
    centers: list[Center],
) -> list[Enrollment]:
    """Enroll candidates in exams with center assignments."""
    enrollments = []
    candidates = [u for u in users if u.role == UserRole.CANDIDATE]

    for exam in exams:
        if exam.status == ExamStatus.DRAFT:
            continue

        for i, candidate in enumerate(candidates):
            enrollment = Enrollment(
                id=str(uuid4()),
                candidate_id=candidate.id,
                exam_id=exam.id,
                center_id=centers[i % len(centers)].id,
                set_label=chr(65 + i % 4),  # A, B, C, D
                roll_number=f"{exam.exam_body.value}-2026-{candidate.state[:3].upper()}-{i+1:07d}",
                status=EnrollmentStatus.ENROLLED,
            )
            db.add(enrollment)
            enrollments.append(enrollment)

    logger.info(f"Created {len(enrollments)} enrollments")
    return enrollments
