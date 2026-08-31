# yuguo_jingrong_jit/voucher/models.py
from django.db import models
from django.db.models import F
from django.utils import timezone

class Voucher(models.Model):
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('paid', 'Paid'),
        ('cancelled', 'Cancelled'),
    )
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    def approve(self):
        """Approve the voucher and record timestamp."""
        if self.status != 'pending':
            raise ValueError("Only pending vouchers can be approved")
        self.status = 'approved'
        self.approved_at = timezone.now()
        self.save()

    def pay(self):
        """Process payment for an approved voucher."""
        if self.status != 'approved':
            raise ValueError("Only approved vouchers can be paid")
        # Fix: Ensure paid_at is set before status change to prevent race condition
        self.paid_at = timezone.now()
        self.status = 'paid'
        self.save()

# yuguo_jingrong_jit/voucher/views.py
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import Voucher

@api_view(['POST'])
def process_voucher_payment(request, voucher_id):
    """
    Process payment for an approved voucher.
    Ensures atomic update to prevent inconsistent state.
    """
    try:
        with transaction.atomic():
            voucher = get_object_or_404(Voucher.objects.select_for_update(), id=voucher_id)
            
            # Validate current status before payment
            if voucher.status != 'approved':
                return Response(
                    {'error': f"Cannot pay voucher with status '{voucher.status}'. Must be 'approved'."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Process payment atomically
            voucher.pay()
            
            return Response({
                'id': voucher.id,
                'status': voucher.status,
                'paid_at': voucher.paid_at.isoformat() if voucher.paid_at else None
            }, status=status.HTTP_200_OK)
            
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)