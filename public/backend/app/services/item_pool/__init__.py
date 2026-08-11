"""
Item pool — the change that makes "a setter cannot leak the paper" arithmetic.

Questions used to belong to an exam from birth, so one setter authored one
paper and knew all of it. Here an item belongs to no exam until a form selects
it, and the selection comes from a beacon that did not exist when the item was
written (design doc §2, §5, §6.1).
"""
from app.services.item_pool.assembly import (  # noqa: F401
    MAX_AUTHOR_SHARE,
    AssemblyError,
    CandidateItem,
    Form,
    build_forms,
    check_blueprint_feasible,
    form_set_root,
    minimum_authors,
    select_form_index,
)
from app.services.item_pool.expander import (  # noqa: F401
    MIN_REL_SEPARATION,
    Distractor,
    ExpandedItem,
    ExpansionResult,
    TemplateSpec,
    VerificationError,
    evaluate,
    expand,
    render,
)
