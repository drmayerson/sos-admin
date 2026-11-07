#!/usr/bin/env python3
"""
Generate SYNTHETIC Summer of Science test data in the exact 2026 export format.

Everything here is invented. Names are generic; e-mail addresses use the reserved
example.com / example.org domains; phone numbers and addresses are fake.
School names are public institution names (or invented) and carry no personal data.

Outputs (in this folder):
  applications_2026_synthetic.csv        UTF-8, ';', CRLF  — like the original website download
  applications_2026_excel_mangled.csv    same data after an Excel open+save (Windows-1252, '?' for
                                         lost characters, dates as dd/mm/yyyy) — the app must warn
  payments_2026_synthetic.csv            payment-form export (5 columns)
  expected_applications.json             oracle: per application row, the expected import outcome
                                         and automatic flags (+ expected LLM verdicts for edge cases)
  expected_payments.json                 oracle: per payment row, the expected match
  config_2026_synthetic.json             a season config (capacities are made up)
  EXPECTED.md                            human-readable list of all deliberate edge cases

Deterministic: same script → same files. Run:  python3 test-data/generate.py
"""
from __future__ import annotations

import csv
import io
import json
import random
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = random.Random(2026)

HEADERS = json.loads((HERE / "headers_2026.json").read_text(encoding="utf-8"))
APP_H: list[str] = HEADERS["applications"]
PAY_H: list[str] = HEADERS["payments"]
assert len(APP_H) == 50 and len(PAY_H) == 5


def H(prefix: str) -> str:
    """Find the unique application header starting with prefix."""
    if prefix in APP_H:
        return prefix
    m = [h for h in APP_H if h.startswith(prefix)]
    assert len(m) == 1, (prefix, m)
    return m[0]


# ---------------------------------------------------------------- season constants
S1 = "Session I (20-24 July 2026)"
S2 = "Session II (3-7 August 2026)"
START = {S1: date(2026, 7, 20), S2: date(2026, 8, 3)}
COURSES = {
    S1: ["ASTROPLASMA", "MAGNETISM", "NUCLEAR", "QUANTUM"],
    S2: ["AVATAR", "ATOMIC", "BLACKHOLES", "CELLNANO", "EXPTECH", "PROTEINS", "RELATIVITY"],
}
COURSE_WEIGHTS = {  # make some courses oversubscribed
    "ASTROPLASMA": 3, "MAGNETISM": 4, "NUCLEAR": 3, "QUANTUM": 6,
    "AVATAR": 2, "ATOMIC": 2, "BLACKHOLES": 6, "CELLNANO": 3, "EXPTECH": 2, "PROTEINS": 3, "RELATIVITY": 5,
}
NOT_APPLYING = {S1: "(Not applying to Session I)", S2: "(Not applying to Session II)"}
SESSION_COLS = {
    S1: [H("Session I: First"), H("Session I: Second"), H("Session I: Third")],
    S2: [H("Session II: First"), H("Session II: Second"), H("Session II: Third")],
}
OTHER = {S1: S2, S2: S1}

ST_FL = "Student at a Flemish (Dutch-speaking) school"
ST_BI = "Student at a Belgian International school"
ST_AB = "International student from abroad"

FB_NA = "Not applicable"
FB_NO = "I DO NOT wish to participate in the summer school"
FB_EVE = "I DO still wish to participate in the summer school, as an EVENING student."
FB_DAY = "I DO still wish to participate in the summer school, as a DAY student."

FEES = {("FULL", True): 380, ("FULL", False): 430, ("EVENING", True): 280,
        ("EVENING", False): 330, ("DAY", True): 200, ("DAY", False): 250}

# ---------------------------------------------------------------- name / school pools
FL_FIRST = ["Lotte", "Wout", "Fien", "Arne", "Noor", "Seppe", "Lien", "Jens", "Emma", "Lars", "Marie",
            "Elise", "Jasper", "Hanne", "Pieter", "Febe", "Ruben", "Ine", "Bram", "Lore", "Tuur",
            "Jolien", "Mats", "Ellen", "Robbe", "Saar", "Warre", "Kato", "Stan", "Amber", "Lowie",
            "Margot", "Kobe", "Nina", "Viktor", "Zoë", "Matthias", "Ilse", "Gilles", "Anouk",
            "Thibault", "Céline", "Joren", "Renée", "Ward", "Hélène", "Siebe", "Amélie"]
FL_LAST = ["Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens",
           "Wouters", "De Smet", "Van den Broeck", "Vermeulen", "Dubois", "Lambrechts", "De Clercq",
           "Van Damme", "Hermans", "Aerts", "Michiels", "Van de Velde", "De Backer", "Verstraete",
           "Coppens", "Smets", "Desmet", "Van Hoof", "Verhoeven", "De Wilde", "Bogaerts", "Cools",
           "D'Hondt", "Van Acker", "Segers", "Baert", "Vandenberghe", "Moens", "Pauwels", "Leclercq"]

INTL = [  # (first names, last names, nationality, language, country, phone prefix)
    (["Ayşe", "Elif", "Mehmet", "Ömer", "Zeynep"], ["Yılmaz", "Karaağaç", "Çelik", "Şahin", "Öztürk"], "Turkish", "Turkish", "Turkey", "+90 5"),
    (["Ioana", "Ștefan", "Andrei", "Bianca"], ["Popescu", "Racoviță", "Ionescu", "Dumitrescu"], "Romanian", "Romanian", "Romania", "+40 7"),
    (["Zofia", "Łukasz", "Kacper", "Maja"], ["Wiśniewska", "Kowalczyk", "Nowak", "Wróbel"], "Polish", "Polish", "Poland", "+48 5"),
    (["Søren", "Freja", "Mads"], ["Østergaard", "Nørgaard", "Jensen"], "Danish", "Danish", "Denmark", "+45 2"),
    (["Chloé", "Théo", "Inès", "Léa"], ["Lefèvre", "Moreau", "Girard", "Rousseau"], "French", "French", "France", "+33 6"),
    (["Matteo", "Giulia", "Lorenzo"], ["Rossi", "Bianchi", "Esposito"], "Italian", "Italian", "Italy", "+39 3"),
    (["José", "Lucía", "Álvaro"], ["Martínez", "García", "Núñez"], "Spanish", "Spanish", "Spain", "+34 6"),
    (["Lena", "Jonas", "Lukas", "Mia"], ["Müller", "Schröder", "Weiß", "Becker"], "German", "German", "Germany", "+49 15"),
    (["Kateřina", "Tomáš"], ["Dvořáková", "Procházka"], "Czech", "Czech", "Czech Republic", "+420 7"),
    (["Ana", "Luka"], ["Kovačević", "Horvat"], "Croatian", "Croatian", "Croatia", "+385 9"),
    (["Wei", "Yiming", "Xinyi"], ["Zhang", "Li", "Wang"], "Chinese", "Mandarin Chinese", "China", "+86 13"),
    (["Priya", "Arjun", "Ananya"], ["Raghunathan", "Iyer", "Sharma"], "Indian", "Tamil, English", "India", "+91 9"),
    (["Lan", "Minh"], ["Nguyễn", "Trần"], "Vietnamese", "Vietnamese", "Vietnam", "+84 9"),
    (["Sarah", "Ciarán", "Aoife"], ["O'Brien", "Ó Súilleabháin", "Murphy"], "Irish", "English", "Ireland", "+353 8"),
    (["Jan-Willem", "Sanne", "Daan"], ["de Vries", "van der Berg", "Bakker"], "Dutch", "Dutch", "Netherlands", "+31 6"),
    (["Yuki", "Haruto"], ["Tanaka", "Suzuki"], "Japanese", "Japanese", "Japan", "+81 90"),
    (["Olusegun", "Adaeze"], ["Adeyemi", "Okafor"], "Nigerian", "Yoruba, English", "Nigeria", "+234 80"),
    (["Björn", "Astrid"], ["Åkesson", "Lindqvist"], "Swedish", "Swedish", "Sweden", "+46 70"),
    (["Dimitris", "Eleni"], ["Papadopoulos", "Georgiou"], "Greek", "Greek", "Greece", "+30 69"),
]

FL_SCHOOLS = {  # canonical → spelling variants students actually type (all Flemish)
    "Sint-Pieterscollege, Leuven": ["Sint-Pieterscollege Leuven", "St-Pieterscollege, Leuven", "SPC Leuven"],
    "Heilig-Hartinstituut, Heverlee": ["Heilig-Hartinstituut Heverlee", "HHI Heverlee", "Heilig Hart Instituut (Heverlee)"],
    "Sint-Albertuscollege, Haasrode": ["Sint-Albertuscollege Haasrode", "SAC Haasrode", "St Albertus college, Haasrode"],
    "Sint-Jozefscollege, Hasselt": ["Sint-Jozefscollege Hasselt", "St Jozefscollege Hasselt", "SJC Hasselt"],
    "Sint-Lodewijkscollege, Brugge": ["Sint-Lodewijkscollege Brugge", "St.-Lodewijkscollege, Brugge"],
    "Sint-Barbaracollege, Gent": ["Sint-Barbaracollege Gent", "Sint Barbara college Gent"],
    "Sint-Romboutscollege, Mechelen": ["Sint-Romboutscollege Mechelen", "SRC Mechelen"],
    "Klein Seminarie, Roeselare": ["Klein Seminarie Roeselare", "KSR Roeselare"],
    "Sint-Michielscollege, Brasschaat": ["Sint-Michielscollege Brasschaat", "SMC Brasschaat"],
    "Sancta Maria, Leuven": ["Sancta Maria Leuven", "Sancta-Maria Leuven"],
    "Paridaensinstituut, Leuven": ["Paridaens Leuven", "Paridaensinstituut Leuven"],
    "Montfortcollege, Rotselaar": ["Montfortcollege Rotselaar", "Montfort college, Rotselaar"],
    "Don Bosco, Haacht": ["Don Bosco Haacht", "Don Bosco Instituut Haacht"],
    "Koninklijk Atheneum, Antwerpen": ["Koninklijk Atheneum Antwerpen", "KA Antwerpen"],
    "GO! atheneum, Mol": ["GO! Atheneum Mol", "Atheneum Mol"],
    "Sint-Vincentiuscollege, Ieper": ["Sint-Vincentiuscollege Ieper", "St Vincent Ieper", "Sint Vincent college, Ieper"],
    "Lyceum, Aalst": ["Sint-Jozefscollege Aalst", "Lyceum Aalst"],
    "Sint-Jan Berchmanscollege, Brussel": ["Sint-Jan Berchmanscollege Brussel", "SJB Brussel"],  # Dutch-language school in Brussels
}
BI_SCHOOLS = ["International School of Brussels", "European School Brussels III (Ixelles)",
              "British School of Brussels, Tervuren", "St. John's International School, Waterloo",
              "Europese School Mol", "BSB Tervuren", "EEB2 Woluwe"]
ABROAD_SCHOOLS = {
    "Turkey": ["Istanbul Erkek Lisesi, Istanbul, Turkey", "TED Ankara Koleji, Ankara, Turkey"],
    "Romania": ["Colegiul Național „Mihai Viteazul”, București, Romania", "Colegiul Național de Informatică, Piatra Neamț, Romania"],
    "Poland": ["XIV Liceum Ogólnokształcące im. Stanisława Staszica, Warszawa, Poland"],
    "Denmark": ["Aarhus Katedralskole, Aarhus, Denmark"],
    "France": ["Lycée Henri-IV, Paris, France", "Lycée du Parc, Lyon, France"],
    "Italy": ["Liceo Scientifico Galileo Galilei, Milano, Italy"],
    "Spain": ["IES Ramiro de Maeztu, Madrid, Spain"],
    "Germany": ["Gymnasium Ottobrunn, Ottobrunn, Germany", "Heinrich-Hertz-Gymnasium, Berlin, Germany"],
    "Czech Republic": ["Gymnázium Jana Keplera, Praha, Czech Republic"],
    "Croatia": ["XV. gimnazija, Zagreb, Croatia"],
    "China": ["High School Affiliated to Renmin University, Beijing, China"],
    "India": ["Delhi Public School R.K. Puram, New Delhi, India"],
    "Vietnam": ["Hanoi-Amsterdam High School, Hanoi, Vietnam"],
    "Ireland": ["Gonzaga College, Dublin, Ireland"],
    "Netherlands": ["Stedelijk Gymnasium Leiden, Leiden, Netherlands"],
    "Japan": ["Shibuya Kyoiku Gakuen, Tokyo, Japan"],
    "Nigeria": ["Loyola Jesuit College, Abuja, Nigeria"],
    "Sweden": ["Norra Real, Stockholm, Sweden"],
    "Greece": ["Ionios School, Athens, Greece"],
}

TOPIC = {
    "ASTROPLASMA": "space weather and the plasma physics of the Sun", "MAGNETISM": "magnetism and magnetic materials",
    "NUCLEAR": "nuclear physics and how atomic nuclei hold together", "QUANTUM": "quantum mechanics and quantum computing",
    "AVATAR": "virtual reality and digital avatars", "ATOMIC": "atoms, lasers and atomic clocks",
    "BLACKHOLES": "black holes and gravitational waves", "CELLNANO": "cells and nanotechnology",
    "EXPTECH": "experimental techniques in a real lab", "PROTEINS": "proteins and how they fold",
    "RELATIVITY": "Einstein's theory of relativity",
}
EN_SENT = [
    "Ever since I was little I have been fascinated by {topic}.",
    "Last year my physics teacher showed us a video about {topic} and I could not stop thinking about it.",
    "I have read several popular science books, and the chapter on {topic} was by far my favourite.",
    "At school we only scratch the surface of these subjects, so I would love to go deeper during a whole week.",
    "I would really like to experience what it is like to study science at a university like KU Leuven.",
    "I am considering studying physics or engineering after secondary school, and this summer school would help me decide.",
    "In my free time I build small electronics projects with an Arduino and I like to understand how things work.",
    "I took part in the national science olympiad this year and reached the second round.",
    "What attracts me most is the combination of theory and hands-on experiments.",
    "I also look forward to meeting other students from different countries who share my passion for science.",
    "I watch a lot of lectures online, but I have never had the chance to ask questions to real researchers.",
    "My grandfather was an engineer and he always encouraged me to ask why things are the way they are.",
    "During a visit to a science museum I saw a demonstration that made me want to learn much more.",
    "I enjoy mathematics a lot, especially when it helps to explain something in nature.",
    "Sometimes the subject feels very abstract, and that is exactly the challenge I am looking for.",
    "I hope to learn how scientists actually do research, not only the results that end up in textbooks.",
    "Living in a student dorm for a week also sounds like a great way to become more independent.",
    "I am a curious person and I am not afraid to work hard on difficult problems.",
    "For a school project I wrote a short report on {topic} and I received very positive feedback.",
    "I would be grateful for the opportunity and I promise to make the most of it.",
]
NL_SENT = [
    "Ik ben al heel lang gefascineerd door {topic_nl}.",
    "Op school zien we hier maar een klein beetje van, dus ik wil er graag veel meer over leren.",
    "Ik twijfel nog tussen burgerlijk ingenieur en fysica, en deze zomerschool kan mij helpen kiezen.",
    "In mijn vrije tijd lees ik veel populairwetenschappelijke boeken en kijk ik naar filmpjes over wetenschap.",
    "Ik zou graag eens ervaren hoe het is om aan de KU Leuven te studeren.",
    "Vorig jaar deed ik mee aan de Vlaamse Fysica Olympiade en dat vond ik superleuk.",
    "Het lijkt me ook heel tof om andere jongeren te leren kennen die dezelfde interesses hebben.",
    "Ik hou van wiskunde, zeker als je er iets mee kan verklaren uit de echte wereld.",
]
TOPIC_NL = {"QUANTUM": "kwantummechanica", "BLACKHOLES": "zwarte gaten", "RELATIVITY": "relativiteitstheorie",
            "MAGNETISM": "magnetisme", "NUCLEAR": "kernfysica", "ASTROPLASMA": "de zon en plasma's"}


def strip_accents(s: str) -> str:
    s = s.replace("ł", "l").replace("Ł", "L").replace("ø", "o").replace("Ø", "O").replace("ß", "ss").replace("ı", "i")
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def email_of(first: str, last: str, domain="example.com", n: int | None = None) -> str:
    base = strip_accents(f"{first}.{last}").lower().replace(" ", "").replace("'", "")
    return f"{base}{n if n else ''}@{domain}"


def words(text: str) -> int:
    return len(text.split())


def motivation(courses: list[str], target: int, dutch=False, paragraphs=True) -> str:
    topic_c = next((c for c in courses if c in TOPIC), "QUANTUM")
    pool = NL_SENT if dutch else EN_SENT
    out: list[str] = []
    sents = pool[:]
    R.shuffle(sents)
    i = 0
    while words(" ".join(out)) < target:
        s = sents[i % len(sents)]
        i += 1
        out.append(s.format(topic=TOPIC[topic_c], topic_nl=TOPIC_NL.get(topic_c, "wetenschap")))
    if paragraphs and len(out) > 6:
        k = len(out) // 2
        return " ".join(out[:k]) + "\r\n\r\n" + " ".join(out[k:])  # multi-line field (quoted in CSV)
    return " ".join(out)


# ---------------------------------------------------------------- timestamps
def fmt_ts(dt: datetime) -> str:
    # Belgian local time; DST started 2026-03-29 03:00 local
    off = "GMT+2" if dt >= datetime(2026, 3, 29, 3, 0) else "GMT+1"
    return dt.strftime("%Y/%m/%d %H:%M:%S.%f") + " " + off


def birth_for(years_left: str, session: str) -> date:
    by = {"0": 2008, "1": 2009, "2": 2010, ">2": 2011}[years_left]
    d = date(by, 1, 1) + timedelta(days=R.randrange(365))
    return d


def age_on(b: date, d: date) -> int:
    return d.year - b.year - ((d.month, d.day) < (b.month, b.day))


# ---------------------------------------------------------------- record building
def blank_row() -> dict[str, str]:
    return {h: "" for h in APP_H}


def make_person(kind: str, used: set[tuple[str, str]]):
    """kind: FL / BI / AB"""
    for _ in range(1000):
        if kind == "FL":
            first, last = R.choice(FL_FIRST), R.choice(FL_LAST)
            nat = R.choice(["Belgian", "Belgian", "Belgium", "BE", "Belgisch", "Belgian, Dutch"])
            lang = R.choice(["Dutch", "Dutch", "Nederlands", "Dutch, French"])
            country, pp = "Belgium", "+32 4"
        else:
            g = R.choice(INTL)
            first, last = R.choice(g[0]), R.choice(g[1])
            nat, lang, country, pp = g[2], g[3], g[4], g[5]
            if kind == "BI":
                country, pp = "Belgium", "+32 4"
        if (first, last) not in used:
            used.add((first, last))
            return dict(first=first, last=last, nat=nat, lang=lang, country=country, pp=pp, kind=kind)
    raise RuntimeError("name pool exhausted")


def phone(pp: str) -> str:
    return pp + "".join(str(R.randrange(10)) for _ in range(2)) + " " + " ".join(
        "".join(str(R.randrange(10)) for _ in range(2)) for _ in range(3))


def address(p) -> str:
    if p["country"] == "Belgium":
        street = R.choice(["Kerkstraat", "Stationsstraat", "Dorpsstraat", "Molenstraat", "Schoolstraat", "Avenue Louise"])
        city = R.choice(["3000 Leuven", "3001 Heverlee", "2000 Antwerpen", "9000 Gent", "8000 Brugge", "3500 Hasselt",
                         "2800 Mechelen", "1050 Brussel", "3080 Tervuren", "1410 Waterloo"])
        return f"{street} {R.randrange(1, 200)}, {city}"
    return f"Example Street {R.randrange(1, 99)}, 00000 Sampletown, {p['country']}"


def build(p, session: str, ts: datetime, *, years_left: str | None = None, birth: date | None = None,
          school: str | None = None, choices: list[str] | None = None, accommodation: str | None = None,
          fallback: str | None = None, mot: str | None = None, status: str | None = None,
          other_cols: str = "auto") -> dict[str, str]:
    r = blank_row()
    yl = years_left or R.choices(["0", "1", "2", ">2"], [12, 50, 30, 8])[0]
    b = birth or birth_for(yl, session)
    st = status or {"FL": ST_FL, "BI": ST_BI, "AB": ST_AB}[p["kind"]]
    if choices is None:
        pool = COURSES[session][:]
        n = R.choices([1, 2, 3], [10, 25, 65])[0]
        choices = []
        while len(choices) < n:
            c = R.choices(pool, [COURSE_WEIGHTS[x] for x in pool])[0]
            if c not in choices:
                choices.append(c)
    if accommodation is None:
        accommodation = R.choices(["FULL", "EVENING", "DAY"], [60, 15, 25] if p["kind"] == "FL" else [90, 4, 6])[0]
    if fallback is None:
        if accommodation == "FULL":
            fallback = R.choices([FB_NA, FB_NO, FB_EVE, FB_DAY, ""], [15, 25, 30, 25, 5])[0]
        else:
            fallback = R.choices([FB_NA, ""], [80, 20])[0]
    if school is None:
        if p["kind"] == "FL":
            school = R.choice(R.choice(list(FL_SCHOOLS.values())))
        elif p["kind"] == "BI":
            school = R.choice(BI_SCHOOLS)
        else:
            school = R.choice(ABROAD_SCHOOLS[p["country"]])
    parent_first = R.choice(["Kristof", "Sofie", "Bart", "Katrien", "Tom", "An", "Mark", "Ingrid", "Peter", "Els"]) \
        if p["kind"] == "FL" else R.choice(["Maria", "John", "Elena", "Ahmed", "Anna", "Michael", "Mei", "Olga"])
    parent_name = f"{parent_first} {p['last']}"

    r[H("Student first name")] = p["first"]
    r[H("Student surname")] = p["last"]
    r[H("Student full address")] = address(p)
    r[H("Student phone number")] = phone(p["pp"])
    r[H("Student e-mail address")] = p.get("email") or email_of(p["first"], p["last"])
    r[H("Student birth date")] = b.isoformat()
    r[H("Student nationality")] = p["nat"]
    r[H("Student primary language")] = p["lang"]
    r[H("Student gender")] = R.choices(["M", "W", "X"], [48, 49, 3])[0]
    r[H("Student: Food")] = R.choices(["No", "None", "", "Vegetarian", "Vegan", "Halal", "Lactose intolerant",
                                      "Nut allergy (carries EpiPen)", "Celiac disease"], [40, 10, 15, 12, 4, 6, 5, 4, 4])[0]
    r[H("Student: Any medical")] = R.choices(["No", "", "None", "Asthma (has inhaler)", "ADHD, takes medication in the morning",
                                             "Type 1 diabetes", "Mild hay fever"], [55, 20, 10, 5, 4, 2, 4])[0]
    r[H("Student T-shirt size")] = R.choices(["XS", "S", "M", "L", "XL"], [8, 30, 35, 20, 7])[0]
    r[H("Parent full name")] = parent_name
    r[H("Parent telephone number")] = phone(p["pp"])
    r[H("Parent e-mail address")] = p.get("parent_email") or email_of(parent_first, p["last"], "example.org")
    r[H("Please send all organizational")] = R.choices(["TRUE", ""], [70, 30])[0]
    r[H("Parent authorization for data")] = "TRUE"
    r[H("Parent authorization for free")] = "TRUE"
    r[H("How did you hear")] = R.choice(["School", "Teacher", "Google/…", "Instagram", "A friend", "Parents",
                                        "KU Leuven website", "Previous participation", ""])
    r[H("Which Session")] = session
    own, oth = SESSION_COLS[session], SESSION_COLS[OTHER[session]]
    for i, col in enumerate(own):
        r[col] = choices[i] if i < len(choices) else ""
    if other_cols == "auto":
        fill = R.choices(["", NOT_APPLYING[OTHER[session]]], [55, 45])[0]
        for col in oth:
            r[col] = fill if fill == "" else (fill if col == oth[0] or R.random() < 0.5 else "")
    r[H("I am able to bring")] = R.choices(["Yes", "No"], [85, 15])[0]
    r[H("Accommodation choice")] = accommodation
    r[H("If you have chosen to participate with")] = fallback
    r[H("If you have chosen to participate as a FULL")] = (
        R.choices(["No", "", "No special requests", "Same hall as my friend from school if possible"], [50, 30, 10, 10])[0]
        if accommodation == "FULL" else "")
    r[H("I am a")] = st
    r[H("Grade/year")] = grade_text(p["kind"], yl)
    r[H("In July 2026")] = yl
    r[H("What school")] = school
    r[H("Study major")] = (R.choice(["Wetenschappen-Wiskunde", "Latijn-Wiskunde", "Economie-Wiskunde",
                                     "Moderne Talen-Wetenschappen", "Wetenschappen-Wiskunde (8u wiskunde)", "Grieks-Latijn"])
                           if p["kind"] == "FL" else
                           R.choice(["IB Diploma (Physics HL, Maths AA HL)", "Science & Math", "Sciences",
                                     "A-levels: Maths, Further Maths, Physics", "Mathematics and Physics", "Spécialité maths-physique"]))
    r[H("Student motivation")] = mot if mot is not None else motivation(
        choices or COURSES[session], R.randrange(230, 480), dutch=(p["kind"] == "FL" and R.random() < 0.12),
        paragraphs=R.random() < 0.6)
    r[H("If you participated")] = R.choices(["N/A", "", "No", "QUANTUM (2025)", "Session II 2024 - BLACKHOLES"], [40, 30, 20, 5, 5])[0]
    r[H("Any other remarks")] = R.choices(["No", "", "Can I arrive at 10:00 on Monday instead of 9:00?",
                                          "I will bring my own laptop.", "Thank you!"], [45, 40, 5, 5, 5])[0]
    r[H("Photo permission")] = R.choices(["Yes", "No"], [88, 12])[0]
    r[H("Data protection")] = "TRUE"
    r[H("Posting Date/Time")] = fmt_ts(ts)
    return r


def grade_text(kind: str, yl: str) -> str:
    if kind == "FL":
        return R.choice({"0": ["6de middelbaar", "6", "6e jaar ASO"], "1": ["5de middelbaar", "5", "5e jaar", "vijfde jaar"],
                         "2": ["4de middelbaar", "4", "4e jaar ASO"], ">2": ["3de middelbaar", "3", "derde jaar"]}[yl])
    return R.choice({"0": ["Year 13", "12th grade", "S7", "Terminale"], "1": ["Year 12", "11th grade", "S6", "Première"],
                     "2": ["Year 11", "10th grade", "S5", "Seconde"], ">2": ["Year 10", "9th grade", "S4"]}[yl])


# ---------------------------------------------------------------- reference implementation of automatic flags
def none_choice(v: str) -> bool:
    return v.strip() == "" or v.strip().startswith("(Not applying")


def auto_flags(r: dict[str, str], cfg) -> list[str]:
    flags = []
    s = r[H("Which Session")]
    own = [r[c] for c in SESSION_COLS[s]]
    oth = [r[c] for c in SESSION_COLS[OTHER[s]]]
    if any(not none_choice(v) for v in oth):
        flags.append("OTHER_SESSION_COURSE")
    if none_choice(own[0]):
        flags.append("NO_FIRST_CHOICE")
    real = [v for v in own if not none_choice(v)]
    if len(set(real)) < len(real):
        flags.append("DUPLICATE_CHOICE")
    seen_empty = False
    for v in own:
        if none_choice(v):
            seen_empty = True
        elif seen_empty:
            flags.append("CHOICE_GAP")
            break
    b = date.fromisoformat(r[H("Student birth date")])
    age = age_on(b, START[s])
    if r[H("In July 2026")] == ">2" or age <= cfg["thresholds"]["youngMaxAge"]:
        flags.append("YOUNG")
    if age >= cfg["thresholds"]["oldMinAge"]:
        flags.append("TOO_OLD")
    if words(r[H("Student motivation")]) < cfg["thresholds"]["minMotivationWords"]:
        flags.append("SHORT_MOTIVATION")
    return flags


# ---------------------------------------------------------------- main
def main():
    cfg = {
        "_note": "Synthetic season config for testing. Capacities are invented, not the real 2026 values.",
        "season": "2026",
        "idPrefix": "SOS26",
        "sessions": [
            {"label": S1, "key": "S1", "startDate": START[S1].isoformat(),
             "courses": [{"code": c, "softMax": 14, "hardMax": 16} for c in COURSES[S1]],
             "dormCapacity": 40},
            {"label": S2, "key": "S2", "startDate": START[S2].isoformat(),
             "courses": [{"code": c, "softMax": 13, "hardMax": 15} for c in COURSES[S2]],
             "dormCapacity": 70},
        ],
        "fees": {"FULL": {"FL": 380, "other": 430}, "EVENING": {"FL": 280, "other": 330}, "DAY": {"FL": 200, "other": 250}},
        "thresholds": {"youngMaxAge": 14, "youngYearsLeft": ">2", "oldMinAge": 19, "minMotivationWords": 50},
        "paymentDeadlineDays": 14,
        "payment": {"structuredReference": "+++400/0029/31560+++", "iban": "BE60 7340 0666 0370"},
    }

    rows: list[dict[str, str]] = []
    meta: list[dict] = []          # parallel to rows: case id, notes, expected import outcome, LLM expectations
    used: set[tuple[str, str]] = set()
    t = datetime(2026, 2, 2, 8, 0)

    def tick(minutes_lo=20, minutes_hi=900) -> datetime:
        nonlocal t
        t = t + timedelta(minutes=R.randrange(minutes_lo, minutes_hi), seconds=R.randrange(60),
                          microseconds=R.randrange(1_000_000))
        return t

    def add(r, case=None, note=None, imp="new", ref=None, llm=None):
        rows.append(r)
        meta.append(dict(case=case, note=note, importOutcome=imp, duplicateOf=ref, llm=llm or {}))
        return len(rows) - 1

    # --- base population (~200) with a few edge cases interleaved
    cases: list[dict] = []

    def case(cid, title, expect):
        cases.append(dict(id=cid, title=title, expect=expect))

    base_kinds = R.choices(["FL", "BI", "AB"], [55, 15, 30], k=200)
    edge_at = {15: "E01", 30: "E03", 45: "E04", 55: "E05", 70: "E06", 78: "E07", 85: "E08", 92: "E09", 99: "E10",
               106: "E11", 113: "E12", 120: "E13", 127: "E14", 134: "E15", 141: "E16", 148: "E17", 151: "E18",
               155: "E19", 160: "E20", 165: "E21", 170: "E22", 175: "E23", 178: "E24", 181: "E25", 184: "E26",
               187: "E27", 190: "E29", 193: "E30", 196: "E31"}
    dst_done = False
    for i, kind in enumerate(base_kinds):
        ts = tick()
        if not dst_done and ts >= datetime(2026, 3, 28, 22, 0):
            # E32: two applications around the DST switch (01:59 GMT+1 and 03:01 GMT+2 are 2 minutes apart)
            dst_done = True
            for hh, mm in [(1, 59), (3, 1)]:
                p = make_person("FL", used)
                add(build(p, S2, datetime(2026, 3, 29, hh, mm, R.randrange(60), R.randrange(1_000_000))), "E32",
                    "Posted around the DST switch: order by true instant (GMT offset!), not by text.")
            case("E32", "Two applications 2 minutes apart across the DST switch (GMT+1 → GMT+2)",
                 "Ordering must use the GMT offset; the 01:59 GMT+1 one is first.")
            t = datetime(2026, 3, 29, 9, 0)
            ts = tick()
        p = make_person(kind, used)
        session = R.choices([S1, S2], [38, 62])[0]
        e = edge_at.get(i)
        if e is None:
            add(build(p, session, ts))
            continue

        if e == "E01":
            p = make_person("FL", used)
            r = build(p, S1, ts)
            a = add(r, "E01", "Original.")
            r2 = dict(r); r2[H("Posting Date/Time")] = fmt_ts(ts + timedelta(minutes=3, microseconds=1234))
            add(r2, "E01", "Identical resubmission 3 min later.", "exact_duplicate", a)
            r3 = dict(r); r3[H("Posting Date/Time")] = fmt_ts(ts + timedelta(minutes=7, microseconds=777))
            r3[H("Student e-mail address")] = "  " + r[H("Student e-mail address")].upper() + " "
            r3[H("Student first name")] = r[H("Student first name")] + " "
            add(r3, "E01", "Third copy, only whitespace/case differences in e-mail and name.", "exact_duplicate", a)
            case("E01", f"{p['first']} {p['last']}: same form submitted 3× (3rd copy differs only in whitespace/case)",
                 "Keep the first; the other two are exact duplicates, removed automatically (no review needed).")
        elif e == "E03":
            p = make_person("AB", used)
            r = build(p, S2, ts, choices=["BLACKHOLES", "RELATIVITY", "ATOMIC"])
            a = add(r, "E03", "Original.")
            r2 = dict(r); r2[H("Posting Date/Time")] = fmt_ts(ts + timedelta(days=1, hours=2, microseconds=4321))
            r2[SESSION_COLS[S2][1]] = "CELLNANO"
            r2[H("Any other remarks")] = "Sorry, I made a mistake in my second choice, this is the correct one."
            add(r2, "E03", "Corrected resubmission next day (2nd choice changed).", "near_duplicate", a)
            case("E03", f"{p['first']} {p['last']}: resubmits next day with a corrected 2nd choice",
                 "Near-duplicate flag. Merge keeps the corrected choices AND the earliest timestamp.")
        elif e == "E04":
            p = make_person("FL", used)
            r = build(p, S2, ts)
            a = add(r, "E04", "Original.")
            r2 = dict(r); r2[H("Posting Date/Time")] = fmt_ts(ts + timedelta(days=3, microseconds=9))
            r2[H("Student e-mail address")] = email_of(p["first"], p["last"], "example.net", 2007)
            r2[H("Student phone number")] = phone("+32 4")
            add(r2, "E04", "Resubmission with a different e-mail address; same name + birth date.", "near_duplicate", a)
            case("E04", f"{p['first']} {p['last']}: resubmits 3 days later with a different e-mail and phone",
                 "Near-duplicate via name + birth date (e-mail differs).")
        elif e == "E05":
            p = make_person("BI", used)
            r = build(p, S1, ts, choices=["QUANTUM", "NUCLEAR"], other_cols="none")
            add(r, "E05", "Session I application.")
            r2 = build(p, S2, ts + timedelta(minutes=12, microseconds=55), choices=["RELATIVITY", "BLACKHOLES", "ATOMIC"],
                       birth=date.fromisoformat(r[H("Student birth date")]), years_left=r[H("In July 2026")],
                       school=r[H("What school")])
            for k in [H("Student full address"), H("Student phone number"), H("Student e-mail address"), H("Parent full name"),
                      H("Parent e-mail address"), H("Parent telephone number"), H("Student gender")]:
                r2[k] = r[k]
            add(r2, "E05", "Separate Session II application by the same student.")
            case("E05", f"{p['first']} {p['last']}: applies to BOTH sessions (two forms, 12 min apart)",
                 "NOT a duplicate. Two applications, two IDs, linked as the same person. Will pay twice.")
        elif e == "E06":
            r = build(p, S1, ts, choices=[], other_cols="none")
            for i2, c in enumerate(["BLACKHOLES", "RELATIVITY"]):
                r[SESSION_COLS[S2][i2]] = c
            add(r, "E06", "Chose Session I but filled in Session II courses only.")
            case("E06", f"{p['first']} {p['last']}: Session I selected, but only Session II courses chosen",
                 "Flags OTHER_SESSION_COURSE + NO_FIRST_CHOICE.")
        elif e == "E07":
            r = build(p, S2, ts, choices=["PROTEINS", "CELLNANO"], other_cols="none")
            r[SESSION_COLS[S1][0]] = "QUANTUM"
            add(r, "E07", "Session II with courses in both sessions (wants both in one form).")
            case("E07", f"{p['first']} {p['last']}: Session II selected, but also a Session I course",
                 "Flag OTHER_SESSION_COURSE (student should submit a second form if they want both).")
        elif e == "E08":
            r = build(p, S2, ts, choices=["", "EXPTECH"])
            add(r, "E08", "Only a 2nd choice.")
            case("E08", f"{p['first']} {p['last']}: only a 2nd choice, 1st empty", "Flags NO_FIRST_CHOICE + CHOICE_GAP.")
        elif e == "E09":
            r = build(p, S1, ts, choices=["MAGNETISM", "MAGNETISM", "QUANTUM"])
            add(r, "E09", "Same course twice.")
            case("E09", f"{p['first']} {p['last']}: same course as 1st and 2nd choice", "Flag DUPLICATE_CHOICE.")
        elif e == "E10":
            r = build(p, S2, ts, choices=["AVATAR", "", "ATOMIC"])
            add(r, "E10", "1st and 3rd choice, 2nd empty.")
            case("E10", f"{p['first']} {p['last']}: 1st and 3rd choice, no 2nd", "Flag CHOICE_GAP.")
        elif e == "E11":
            r = build(p, S1, ts, choices=["ASTROPLASMA", "NUCLEAR"], other_cols="none")
            for c in SESSION_COLS[S2]:
                r[c] = NOT_APPLYING[S2]
            add(r, "E11", "Other-session columns all '(Not applying to Session II)'.")
            case("E11", f"{p['first']} {p['last']}: other session's columns all '(Not applying to Session II)'",
                 "Valid — no flag.")
        elif e == "E12":
            p = make_person("FL", used)
            r = build(p, S2, ts, years_left=">2", birth=date(2011, 2, 14))
            add(r, "E12", "Years left '>2', age 15.")
            case("E12", f"{p['first']} {p['last']}: years left '>2' (age 15)", "Flag YOUNG (via years left).")
        elif e == "E13":
            p = make_person("AB", used)
            r = build(p, S1, ts, years_left="2", birth=date(2011, 11, 3))
            add(r, "E13", "Age 14 at session start, years left 2.")
            case("E13", f"{p['first']} {p['last']}: age 14 at Session I start, says 2 years left", "Flag YOUNG (via age).")
        elif e == "E14":
            p = make_person("FL", used)
            add(build(p, S1, ts, years_left="2", birth=date(2011, 7, 20)), "E14", "Turns 15 ON the Session I start date.")
            p2 = make_person("FL", used)
            add(build(p2, S1, ts + timedelta(minutes=40), years_left="2", birth=date(2011, 7, 21)), "E14",
                "Turns 15 the day AFTER the Session I start date.")
            case("E14", f"Age boundary: {p['first']} {p['last']} turns 15 on 20 July 2026 (Session I start); "
                        f"{p2['first']} {p2['last']} turns 15 on 21 July 2026",
                 "First: no flag (age 15). Second: flag YOUNG (age 14).")
        elif e == "E15":
            p = make_person("AB", used)
            m = motivation(["QUANTUM"], 260, paragraphs=False) + \
                " I just finished my first year of a bachelor in physics and I want to deepen my knowledge."
            r = build(p, S1, ts, years_left="0", birth=date(2006, 5, 2), choices=["QUANTUM", "NUCLEAR"], mot=m)
            add(r, "E15", "Born 2006, years left 0, motivation mentions a bachelor programme.",
                llm={"motivation": "FLAG: appears to be a university student"})
            case("E15", f"{p['first']} {p['last']}: born 2006 (age 20), mentions first bachelor year",
                 "Flag TOO_OLD. LLM motivation check should also flag 'university student'.")
        elif e == "E16":
            p = make_person("FL", used)
            add(build(p, S2, ts, years_left="0", birth=date(2007, 8, 4)), "E16", "Turns 19 the day after Session II start.")
            case("E16", f"{p['first']} {p['last']}: turns 19 on 4 Aug 2026 (day after Session II start)",
                 "No flag (age 18 on the start date).")
        elif e == "E17":
            m = "I like science and I want to learn more about it. My teacher said this was a good summer school. I hope I can come."
            add(build(p, S2, ts, mot=m), "E17", "Motivation of 25 words.",
                llm={"motivation": "FLAG: very short, no reason given"})
            case("E17", f"{p['first']} {p['last']}: motivation of {words(m)} words", "Flag SHORT_MOTIVATION.")
        elif e == "E18":
            m49 = " ".join(["I"] + ("really love physics and I would enjoy this week very much".split() * 5))[:]
            w = m49.split()[:49]
            m49 = " ".join(w) + "."
            add(build(p, S1, ts, mot=m49), "E18", "Motivation of exactly 49 words.")
            p2 = make_person(kind, used)
            m50 = " ".join(w + ["Thanks"]) + "."
            add(build(p2, S2, ts + timedelta(minutes=5), mot=m50), "E18", "Motivation of exactly 50 words.")
            case("E18", f"Word-count boundary: {p['first']} {p['last']} 49 words; {p2['first']} {p2['last']} 50 words",
                 "49 → SHORT_MOTIVATION; 50 → no flag (threshold: fewer than 50).")
        elif e == "E19":
            p = make_person("FL", used)
            school = "Sint-Pieterscollege Leuven"
            m = (f"My name is {p['first']} {p['last']} and I am a student at {school}. " +
                 motivation(["MAGNETISM"], 240, paragraphs=False) +
                 f" You can always reach me at {email_of(p['first'], p['last'])}. Greetings, {p['first'].upper()}")
            add(build(p, S1, ts, school=school, choices=["MAGNETISM", "QUANTUM"], mot=m), "E19",
                "Motivation contains own name (also in capitals), school and e-mail.",
                llm={"redaction": "first name, surname, school and e-mail must all be replaced before sending"})
            case("E19", f"{p['first']} {p['last']}: motivation contains their name (also in CAPITALS), school and e-mail",
                 "Redaction test: all four must be replaced by placeholders before the text goes to the LLM.")
        elif e == "E20":
            p = make_person("FL", used)
            add(build(p, S2, ts, choices=["RELATIVITY", "BLACKHOLES"],
                      mot=motivation(["RELATIVITY"], 300, dutch=True)), "E20", "Motivation in Dutch.",
                llm={"motivation": "no flag"})
            case("E20", f"{p['first']} {p['last']}: motivation in Dutch", "No automatic flag; LLM: no flag.")
        elif e == "E21":
            p = make_person("BI", used)
            m = ("Honestly I am applying because my parents want me to do something useful this summer. "
                 "I do not really know what the courses are about and I am not very interested in science, "
                 "but my friend is going so I thought I would also apply. ") + motivation(["CELLNANO"], 120, paragraphs=False)
            add(build(p, S2, ts, choices=["CELLNANO"], mot=m), "E21", "Long enough but questionable motivation.",
                llm={"motivation": "FLAG: little genuine interest"})
            case("E21", f"{p['first']} {p['last']}: long enough, but says they aren't interested in science",
                 "No automatic flag; LLM motivation check should flag it.")
        elif e == "E22":
            m = ('"Why?" — that is the question I ask most often; my teachers sometimes get tired of it.\r\n'
                 'I once built a "cloud chamber" at home (dry ice; isopropyl alcohol; a fish tank) and saw tracks!\r\n\r\n'
                 + motivation(["NUCLEAR"], 220, paragraphs=False))
            add(build(p, S1, ts, choices=["NUCLEAR", "QUANTUM"], mot=m), "E22",
                "Motivation with quotes, semicolons and line breaks.")
            case("E22", f"{p['first']} {p['last']}: motivation with double quotes, semicolons and line breaks",
                 "CSV parsing: must stay one field; no flag.")
        elif e == "E23":
            p = make_person("BI", used)
            add(build(p, S2, ts, status=ST_FL, school="International School of Brussels"), "E23",
                "Claims Flemish school but attends an international school.", llm={"school": "not Flemish"})
            case("E23", f"{p['first']} {p['last']}: claims Flemish status, school 'International School of Brussels'",
                 "Goes to the school check; LLM: not Flemish → human confirms non-FL (fee 430/330/250).")
        elif e == "E24":
            p = make_person("FL", used)
            add(build(p, S1, ts, school="St Vincent Ieper"), "E24", "Abbreviated Flemish school name.",
                llm={"school": "Flemish"})
            case("E24", f"{p['first']} {p['last']}: Flemish, school written 'St Vincent Ieper'",
                 "LLM: Flemish (alias of Sint-Vincentiuscollege Ieper); store alias.")
        elif e == "E25":
            p = make_person("FL", used)
            add(build(p, S2, ts, school="Athénée Royal d'Uccle 1"), "E25", "Claims Flemish, French-speaking Brussels school.",
                llm={"school": "not Flemish"})
            case("E25", f"{p['first']} {p['last']}: claims Flemish, school 'Athénée Royal d'Uccle 1' (French-speaking)",
                 "LLM: not Flemish → plain non-FL, no special status.")
        elif e == "E26":
            p = make_person("FL", used)
            add(build(p, S2, ts, school="Sint-Jan Berchmanscollege Brussel"), "E26", "Dutch-language school in Brussels.",
                llm={"school": "Flemish"})
            case("E26", f"{p['first']} {p['last']}: Dutch-language school in Brussels",
                 "LLM: Flemish (Brussels Dutch-language schools count).")
        elif e == "E27":
            p = make_person("FL", used)
            add(build(p, S1, ts, school="middelbare school"), "E27", "Vague school name.", llm={"school": "unclear"})
            case("E27", f"{p['first']} {p['last']}: school given as 'middelbare school'", "LLM: unclear → human decides.")
        elif e == "E29":
            r = build(p, S2, ts)
            r[H("Please send all organizational")] = ""
            add(r, "E29", "Parent org-mail checkbox not ticked.")
            case("E29", f"{p['first']} {p['last']}: 'send all organizational e-mails also to parent' not ticked",
                 "Parent still gets admission/payment e-mails; not other organizational mails.")
        elif e == "E30":
            add(build(p, S2, ts, accommodation="FULL", fallback=FB_NO), "E30", "FULL; if dorms full: does NOT participate.")
            p2 = make_person(kind, used)
            add(build(p2, S2, ts + timedelta(minutes=9), accommodation="FULL", fallback=FB_EVE), "E30",
                "FULL; if dorms full: EVENING.")
            p3 = make_person("FL", used)
            add(build(p3, S2, ts + timedelta(minutes=17), accommodation="DAY", fallback=FB_NA), "E30", "DAY; fallback N/A.")
            case("E30", f"Accommodation fallbacks: {p['first']} {p['last']} (FULL → don't come), "
                        f"{p2['first']} {p2['last']} (FULL → EVENING), {p3['first']} {p3['last']} (DAY, N/A)",
                 "Used by the dorm-full handling in phase 2.")
        elif e == "E31":
            p = make_person("FL", used)
            r = build(p, S1, ts)
            r[H("Student first name")] = " " + p["first"].upper()
            r[H("Student surname")] = p["last"].upper() + "  "
            add(r, "E31", "Name in capitals with stray spaces.")
            case("E31", f"{p['first']} {p['last']}: name typed in CAPITALS with extra spaces",
                 "Normalise for matching/display (trim; keep original in RawImports).")

    # E28 (non-ASCII) is covered by the base population; E33: student uses parent e-mail
    p = make_person("FL", used)
    shared = email_of("Familie", p["last"], "example.org")
    p["email"] = shared; p["parent_email"] = shared
    add(build(p, S2, tick()), "E33", "Student and parent e-mail are the same.")
    case("E33", f"{p['first']} {p['last']}: student e-mail = parent e-mail",
         "No flag; mail merge must not send the same e-mail twice.")
    case("E28", "Many names with non-Western characters (ş, ț, ł, ø, ễ, Ó…)",
         "Must survive import/export unchanged. The Excel-mangled file must trigger the 're-saved in Excel' warning.")

    # --- assign IDs in posting order (true instant) and compute expectations
    def instant(r):
        s = r[H("Posting Date/Time")]
        dt = datetime.strptime(s[:26], "%Y/%m/%d %H:%M:%S.%f")
        return dt - timedelta(hours=int(s.split("GMT")[1]))

    order = sorted(range(len(rows)), key=lambda i: instant(rows[i]))
    ids, n = {}, 0
    for i in order:
        if meta[i]["importOutcome"] != "exact_duplicate":
            n += 1
            ids[i] = f"SOS26-{n:04d}"

    expected = []
    for i in order:
        r, m = rows[i], meta[i]
        expected.append(dict(
            postingDateTime=r[H("Posting Date/Time")],
            studentEmail=r[H("Student e-mail address")],
            name=f"{r[H('Student first name')].strip()} {r[H('Student surname')].strip()}",
            session=r[H("Which Session")],
            expectedId=ids.get(i),
            importOutcome=m["importOutcome"],
            duplicateOfPostingDateTime=rows[m["duplicateOf"]][H("Posting Date/Time")] if m["duplicateOf"] is not None else None,
            autoFlags=[] if m["importOutcome"] == "exact_duplicate" else auto_flags(r, cfg),
            claimsFlemish=r[H("I am a")] == ST_FL,
            expectedFeeIfFlemishConfirmed=FEES[(r[H("Accommodation choice")], r[H("I am a")] == ST_FL and m["llm"].get("school") != "not Flemish")],
            case=m["case"], note=m["note"], llm=m["llm"] or None,
        ))

    # --- payments: pick ~110 non-duplicate applications as "paid"
    pay_rows, pay_exp = [], []
    candidates = [i for i in order if meta[i]["importOutcome"] == "new" and meta[i]["case"] not in ("E05", "E33")]
    paid = R.sample(candidates, 110)
    proof_names = ["screenshot.png", "Screenshot 2026-05-0{}.png", "IMG_{}.jpeg", "Betalingsbewijs.pdf",
                   "overschrijving.pdf", "payment.jpg", "proof_of_payment.pdf", "image.png"]

    def proof():
        f = R.choice(proof_names)
        return f.format(R.randrange(1, 9) if "0{}" in f else R.randrange(1000, 9999)) if "{}" in f else f

    pcase = {}
    for k, i in enumerate(paid):
        r = rows[i]
        sid = ids[i]
        full = f"{r[H('Student first name')].strip()} {r[H('Student surname')].strip()}"
        email, name, how, cid = r[H("Student e-mail address")].strip(), full, "email_student", None
        roll = k % 20
        if roll in (1, 2, 3, 4, 5, 6):
            email, how = r[H("Parent e-mail address")], "email_parent"
        elif roll == 7:
            email, how, cid = "  " + r[H("Student e-mail address")].strip().upper(), "email_student (case/whitespace)", "P03"
        elif roll == 8:
            email, how, cid = email_of("someone", "else", "example.net", k), "name_exact", "P04"
        elif roll == 9:
            email, name, how, cid = email_of("x", str(k), "example.net"), strip_accents(full), "name_fuzzy (no accents)", "P05"
        elif roll == 10:
            email, how, cid = email_of("y", str(k), "example.net"), "name_fuzzy (reversed order)", "P06"
            name = f"{r[H('Student surname')].strip()} {r[H('Student first name')].strip()}"
        elif roll == 11:
            email, name, how, cid = email_of("z", str(k), "example.net"), r[H("Parent full name")], "parent_name", "P07"
        elif roll == 12:
            email, how, cid = email_of("w", str(k), "example.net"), "name_fuzzy (first name only + surname typo)", "P08"
            last = r[H("Student surname")].strip()
            name = f"{r[H('Student first name')].strip()} {last[:-1] if len(last) > 3 else last + 'e'}"
        pay_rows.append({PAY_H[0]: name, PAY_H[1]: email, PAY_H[2]: proof(), PAY_H[3]: "", PAY_H[4]: "TRUE"})
        pay_exp.append(dict(row=len(pay_rows), matchesId=sid, method=how, case=cid))
        pcase.setdefault(cid, (name, email, sid))

    # P09 unmatched
    pay_rows.append({PAY_H[0]: "Jean Dupont", PAY_H[1]: "jean.dupont@example.net", PAY_H[2]: "screenshot.png",
                     PAY_H[3]: "", PAY_H[4]: "TRUE"})
    pay_exp.append(dict(row=len(pay_rows), matchesId=None, method="unmatched", case="P09"))
    # P10 two-session student pays twice (E05)
    e05 = [i for i in order if meta[i]["case"] == "E05"]
    for i in e05:
        r = rows[i]
        pay_rows.append({PAY_H[0]: f"{r[H('Student first name')]} {r[H('Student surname')]}", PAY_H[1]: r[H("Student e-mail address")],
                         PAY_H[2]: proof(), PAY_H[3]: "", PAY_H[4]: "TRUE"})
        pay_exp.append(dict(row=len(pay_rows), matchesId=[ids[j] for j in e05], method="email_student (two applications — ambiguous session)",
                            case="P10"))
    # P12 identical payment-form submission twice
    dup = dict(pay_rows[0])
    pay_rows.append(dup)
    pay_exp.append(dict(row=len(pay_rows), matchesId=pay_exp[0]["matchesId"], method="exact duplicate of row 1", case="P12"))

    # ---------------------------------------------------------------- write files
    def write_csv(path: Path, header: list[str], data: list[dict], encoding: str, mangle_dates=False):
        buf = io.StringIO(newline="")
        w = csv.writer(buf, delimiter=";", lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
        w.writerow(header)
        for d in data:
            row = [d.get(h, "") for h in header]
            if mangle_dates:
                bd = header.index(H("Student birth date"))
                y, mo, dd = row[bd].split("-")
                row[bd] = f"{dd}/{mo}/{y}"
            w.writerow(row)
        path.write_bytes(buf.getvalue().encode(encoding, errors="replace"))

    app_out = [rows[i] for i in order]
    write_csv(HERE / "applications_2026_synthetic.csv", APP_H, app_out, "utf-8")
    write_csv(HERE / "applications_2026_excel_mangled.csv", APP_H, app_out, "cp1252", mangle_dates=True)
    write_csv(HERE / "payments_2026_synthetic.csv", PAY_H, pay_rows, "utf-8")
    (HERE / "expected_applications.json").write_text(json.dumps(expected, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "expected_payments.json").write_text(json.dumps(pay_exp, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "config_2026_synthetic.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    # EXPECTED.md
    from collections import Counter
    fc = Counter(f for e in expected for f in e["autoFlags"])
    pc = {
        "P03": "e-mail matches the student e-mail after trimming + lower-casing",
        "P04": "unknown e-mail, exact student name",
        "P05": "unknown e-mail, name without accents",
        "P06": "unknown e-mail, surname first",
        "P07": "unknown e-mail, PARENT's name given → also match against parent names",
        "P08": "unknown e-mail, surname typo → top-3 candidates for a human",
    }
    lines = ["# Synthetic test data — expected outcomes", "",
             "*Generated by `generate.py` — do not edit by hand. All people, e-mails, phones and addresses are fictitious.*", "",
             "## Files", "",
             "| File | What |", "|---|---|",
             f"| `applications_2026_synthetic.csv` | {len(app_out)} application rows, exact 2026 export format (UTF-8, `;`, CRLF), in posting order |",
             "| `applications_2026_excel_mangled.csv` | Same rows after an Excel open+save: Windows-1252 (`?` for lost characters), birth dates `dd/mm/yyyy` → app must warn |",
             f"| `payments_2026_synthetic.csv` | {len(pay_rows)} payment-form rows |",
             "| `expected_applications.json` | Oracle per application: expected ID, import outcome, automatic flags, expected LLM verdicts |",
             "| `expected_payments.json` | Oracle per payment row: which application ID it should match, and how |",
             "| `config_2026_synthetic.json` | Season config (2026 courses/dates/fees; capacities invented) |",
             "| `headers_2026.json` | Exact headers of the real 2026 exports |", "",
             "## Summary", "",
             f"- Applications: {len(app_out)} rows → {sum(1 for e in expected if e['importOutcome'] != 'exact_duplicate')} after removing "
             f"{sum(1 for e in expected if e['importOutcome'] == 'exact_duplicate')} exact duplicates; "
             f"{sum(1 for e in expected if e['importOutcome'] == 'near_duplicate')} near-duplicates to review.",
             f"- Claiming Flemish status: {sum(1 for e in expected if e['claimsFlemish'] and e['importOutcome'] != 'exact_duplicate')}.",
             "- Automatic flags: " + ", ".join(f"{k} {v}" for k, v in sorted(fc.items())) + ".",
             "- IDs are assigned in true posting order (GMT offset taken into account), skipping exact duplicates.", "",
             "Flag names used in the oracle: `OTHER_SESSION_COURSE`, `NO_FIRST_CHOICE`, `DUPLICATE_CHOICE`, `CHOICE_GAP`, "
             "`YOUNG`, `TOO_OLD`, `SHORT_MOTIVATION`. Base-population rows can also carry flags (e.g. random `>2` students) — "
             "`expected_applications.json` is authoritative.", "",
             "## Deliberate edge cases — applications", "", "| Case | Situation | Expected |", "|---|---|---|"]
    for c in sorted(cases, key=lambda c: int(c["id"][1:])):
        lines.append(f"| {c['id']} | {c['title']} | {c['expect']} |")
    lines += ["", "## Deliberate edge cases — payments", "", "| Case | Situation |", "|---|---|"]
    lines += [f"| {k} | {v} (e.g. `{pcase[k][0]}`, expected {pcase[k][2]}) |" for k, v in pc.items() if k in pcase]
    lines += ["| P09 | Payer matches nobody (`Jean Dupont`) → manual |",
              "| P10 | Student with two applications (E05) pays twice with the same e-mail → session ambiguous, human links each payment |",
              "| P12 | The very same payment-form submission twice (identical row) → exact duplicate |",
              "| — | Many proof files share names like `screenshot.png` / `image.png` → file-name matching alone is not unique |",
              "", "Most other payments match on the student e-mail (plain) or the parent e-mail.", "",
              "## Not covered by synthetic data", "",
              "- Real quoting/BOM details of the website export (see DESIGN.md §8 unverified assumptions).",
              "- Proof-of-payment images (phase 3: create a handful of fake bank screenshots then)."]
    (HERE / "EXPECTED.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"applications: {len(app_out)} rows, payments: {len(pay_rows)} rows, flags: {dict(fc)}")


if __name__ == "__main__":
    main()
