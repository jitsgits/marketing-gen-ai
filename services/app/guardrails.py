import re
import logging

logger = logging.getLogger("guardrails")

# Singleton engines / pipelines for lazy loading
_analyzer = None
_anonymizer = None
_guard_pipeline = None

# ==========================================
# REGEX FALLBACKS (If Presidio/Transformers are unavailable)
# ==========================================
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
PHONE_REGEX = re.compile(r"\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}")
SSN_REGEX = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

JAILBREAK_PATTERNS = [
    re.compile(r"ignore\s+(?:[a-zA-Z]+\s+)*(?:instructions|rules|directives|guidelines)", re.IGNORECASE),
    re.compile(r"bypass\s+(?:[a-zA-Z]+\s+)*(?:restrictions|filters|governance|rules)", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:[a-zA-Z]+\s+)*(?:unrestricted|jailbroken|unfiltered|free|bypass)", re.IGNORECASE),
    re.compile(r"dan\s+mode", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"hack\s+(?:a|the|our|your|\s+)*(?:computer|network|system|server|database|gcs)", re.IGNORECASE),
    re.compile(r"how\s+to\s+(?:[a-zA-Z]+\s+)*(?:make|build|create|write|hack)\s+(?:[a-zA-Z]+\s+)*(?:bomb|weapon|virus|exploit|malware)", re.IGNORECASE),
]

def _fallback_clean_pii(text: str) -> str:
    """Uses regex patterns to sanitize PII if Presidio is not available."""
    sanitized = text
    sanitized = EMAIL_REGEX.sub("<EMAIL>", sanitized)
    sanitized = SSN_REGEX.sub("<SSN>", sanitized)
    # Be slightly careful with phone numbers to not redact normal numbering;
    # we target standard phone shapes with length constraints.
    sanitized = PHONE_REGEX.sub("<PHONE_NUMBER>", sanitized)
    return sanitized

def _fallback_check_malicious(text: str) -> bool:
    """Uses keyword/regex matching to detect prompt injection if Llama Prompt Guard is unavailable."""
    for pattern in JAILBREAK_PATTERNS:
        if pattern.search(text):
            logger.warning(f"Malicious prompt signature matched: {pattern.pattern}")
            return True
    return False

# ==========================================
# LAZY INITIALIZATION HELPERS
# ==========================================
def _get_presidio_engines():
    global _analyzer, _anonymizer
    if _analyzer is None or _anonymizer is None:
        try:
            from presidio_analyzer import AnalyzerEngine
            from presidio_anonymizer import AnonymizerEngine
            _analyzer = AnalyzerEngine()
            _anonymizer = AnonymizerEngine()
            logger.info("Microsoft Presidio Analyzer and Anonymizer engines successfully loaded.")
        except ImportError as ie:
            logger.warning(f"Presidio packages missing; falling back to regex PII filters. Details: {ie}")
            raise ie
        except Exception as e:
            logger.error(f"Failed to initialize Microsoft Presidio: {e}. Falling back to regex.")
            raise e
    return _analyzer, _anonymizer

def _get_guard_pipeline():
    global _guard_pipeline
    if _guard_pipeline is None:
        try:
            # Check for torch and transformers availability
            import torch
            from transformers import pipeline
            
            logger.info("Loading Meta Llama-Prompt-Guard-2-22M model...")
            # Use small 22M version for quick execution
            _guard_pipeline = pipeline(
                "text-classification",
                model="meta-llama/Llama-Prompt-Guard-2-22M",
                device="cuda" if torch.cuda.is_available() else "cpu"
            )
            logger.info("Meta Llama-Prompt-Guard-2-22M model loaded successfully.")
        except ImportError as ie:
            logger.warning(f"Hugging Face transformers/torch packages missing; falling back to keyword jailbreak detectors. Details: {ie}")
            raise ie
        except Exception as e:
            logger.error(f"Failed to load Llama-Prompt-Guard model: {e}. Falling back to keyword jailbreak detectors.")
            raise e
    return _guard_pipeline

# ==========================================
# CENTRAL VALIDATION ENTRYPOINT
# ==========================================
def clean_pii(text: str) -> str:
    """Finds and replaces PII with tokens like <PHONE_NUMBER>."""
    if not text:
        return text
    try:
        analyzer, anonymizer = _get_presidio_engines()
        results = analyzer.analyze(text=text, language="en")
        anonymized_text = anonymizer.anonymize(text=text, analyzer_results=results)
        return anonymized_text.text
    except Exception:
        # Graceful fallback to regex patterns
        return _fallback_clean_pii(text)

def check_malicious_intent(text: str) -> bool:
    """Returns True if a prompt injection or jailbreak is detected."""
    if not text:
        return False
    try:
        pipeline_engine = _get_guard_pipeline()
        prediction = pipeline_engine(text)[0]
        # The model labels text as 'BENIGN' or 'MALICIOUS'
        return prediction['label'] == 'MALICIOUS'
    except Exception:
        # Graceful fallback to keyword signature checks
        return _fallback_check_malicious(text)

def validate_and_sanitize_prompt(user_input: str) -> str:
    """
    Central validation pipeline wrapper.
    1. Redacts PII (anonymizes it inline)
    2. Scans for malicious jailbreaks / prompt injection (raises ValueError if found)
    """
    if not user_input:
        return user_input

    # Layer 1: Strip PII
    sanitized_input = clean_pii(user_input)
    
    # Layer 2: Check for attacks
    if check_malicious_intent(sanitized_input):
        raise ValueError("Security violation: Malicious prompt detected.")
        
    return sanitized_input
