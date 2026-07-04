import os
import logging
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.sdk.resources import Resource

# Create Logger
logger = logging.getLogger("telemetry")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

def init_telemetry(service_name: str) -> trace.Tracer:
    """
    Initializes the OpenTelemetry Tracer Provider with standard resources.
    Traces are emitted to the stdout console, which GCP Cloud Logging collects.
    """
    try:
        # Define Resource attributes for OpenTelemetry
        resource = Resource.create(attributes={
            "service.name": service_name,
            "service.namespace": "marketing-genai",
            "environment": os.getenv("ENVIRONMENT", "production")
        })

        provider = TracerProvider(resource=resource)
        
        # In a real enterprise setup, we export to a collector (like Google Cloud Trace).
        # Emitting to console allows standard structured logging compatibility out-of-the-box.
        exporter = ConsoleSpanExporter()
        processor = SimpleSpanProcessor(exporter)
        provider.add_span_processor(processor)
        
        trace.set_tracer_provider(provider)
        logger.info(f"OpenTelemetry telemetry context initialized for: {service_name}")
        
    except Exception as e:
        logger.error(f"Failed to initialize OpenTelemetry context: {e}")
        
    return trace.get_tracer(service_name)
